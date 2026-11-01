import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
export interface NativeOutcome {attempted:boolean;nativeReturned?:boolean;error?:string;cleanupError?:boolean}
export interface QuotedPhotoIdentity {conversationId:string;senderId:string;serverId:string;localId:number;md5:string}
export interface QuotedDownloadResult {id:string;state:'pending'|'busy'|'complete'|'failed'|'cancelled'|'missing';kind?:number;error?:string;released?:boolean}
const downloadSchema=z.object({id:z.string().uuid(),state:z.enum(['pending','busy','complete','failed','cancelled','missing']),kind:z.number().int().optional(),error:z.string().optional(),released:z.boolean().optional()});
export interface NativeBridgeStatus {ready:boolean;busy:boolean;expiresAt:number;state?:string;reconnectAttempts?:number;nextAttemptAt?:number;scannedBytes?:number;scanErrors?:number;destroyed?:number;readyTargetCount?:number;requiresChatWindow?:boolean;imagesSupported?:boolean;quotedDownloadsSupported?:boolean}
export interface NativeBridgePort {
  start():Promise<void>;stop():Promise<void>;
  status():Promise<NativeBridgeStatus>;
  send(target:string,text:string):Promise<NativeOutcome>;
  sendImage?(target:string,path:string,size:number,md5:string):Promise<NativeOutcome>;
  readCachedImage?(path:string,md5:string):Promise<string|undefined>;
  startQuotedDownload?(photo:QuotedPhotoIdentity & {id:string}):Promise<QuotedDownloadResult>;
  quotedDownloadStatus?(id:string):Promise<QuotedDownloadResult>;
  cancelQuotedDownload?(id:string):Promise<QuotedDownloadResult>;
}
export class NativeMemoBridge implements NativeBridgePort {
  private child?:ChildProcessWithoutNullStreams;
  private stopping?:Promise<void>;
  private pending=new Map<string,{child:ChildProcessWithoutNullStreams;resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  constructor(private python:string,private spawnHost=()=>spawn(this.python,['-X','utf8',resolve('native/memo-host.py'),'--enable-native-memo-test'],{cwd:process.cwd(),windowsHide:true,stdio:'pipe'})){}
  async start(){
    await this.stopping;
    if(this.child)return;
    const child=this.spawnHost();this.child=child;
    const lines=createInterface({input:child.stdout});
    child.stderr.resume(); // Python host reports sanitized diagnostics over its JSON protocol.
    await new Promise<void>((resolveReady,rejectReady)=>{
      const timeout=setTimeout(()=>rejectReady(new Error('Native bridge startup timeout')),25000);
      const fail=(error:Error)=>{clearTimeout(timeout);rejectReady(error);for(const [id,item] of this.pending){if(item.child===child){clearTimeout(item.timer);item.reject(error);this.pending.delete(id);}}if(this.child===child)child.kill();};
      child.stdin.on('error',()=>fail(new Error('Native bridge input pipe failed')));
      child.once('error',()=>fail(new Error('Native bridge process failed')));
      child.once('exit',()=>{if(this.child===child)this.child=undefined;lines.close();fail(new Error('Native bridge exited'));});
      lines.on('line',line=>{try{
        const value=JSON.parse(line);
        if(value.event==='ready'){clearTimeout(timeout);resolveReady();}
        if(value.event==='fatal'||value.event==='agent-error')fail(new Error('Native bridge initialization or agent failure'));
        if(typeof value.id==='string'){const item=this.pending.get(value.id);if(item?.child===child){this.pending.delete(value.id);clearTimeout(item.timer);if(value.error)item.reject(new Error('Native outcome unavailable'));else item.resolve(value.result);}}
      }catch{fail(new Error('Invalid native bridge protocol'));}});
    }).catch(async error=>{await this.stop();throw error;});
  }
  private command(op:string,payload:Record<string,unknown>={}):Promise<unknown>{
    const child=this.child;if(!child||this.stopping)return Promise.reject(new Error('Native bridge disconnected'));
    return new Promise((resolveResult,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Native command timeout; outcome unknown'));},6500);this.pending.set(id,{child,resolve:resolveResult,reject,timer});child.stdin.write(JSON.stringify({id,op,...payload})+'\n',error=>{if(error){const item=this.pending.get(id);if(item){clearTimeout(item.timer);this.pending.delete(id);reject(new Error('Native command pipe failed'));}}});});
  }
  async status(){return z.object({ready:z.boolean(),busy:z.boolean(),expiresAt:z.number(),state:z.string().optional(),scannedBytes:z.number().optional(),scanErrors:z.number().optional(),destroyed:z.number().optional(),readyTargetCount:z.number().optional(),requiresChatWindow:z.boolean().optional(),imagesSupported:z.boolean().optional(),quotedDownloadsSupported:z.boolean().optional()}).parse(await this.command('status'));}
  async send(target:string,text:string){const result=z.object({attempted:z.boolean(),nativeReturned:z.boolean().optional(),error:z.string().optional(),cleanupError:z.boolean().optional()}).parse(await this.command('send',{target,text}));if(result.cleanupError)await this.stop();return result;}
  async sendImage(target:string,path:string,size:number,md5:string){const result=z.object({attempted:z.boolean(),nativeReturned:z.boolean().optional(),error:z.string().optional(),cleanupError:z.boolean().optional()}).parse(await this.command('send-image',{target,path,size,md5}));if(result.cleanupError)await this.stop();return result;}
  async readCachedImage(path:string,md5:string){return z.object({base64:z.string().max(27962028).optional()}).parse(await this.command('read-cached-image',{path,md5})).base64;}
  async startQuotedDownload(photo:QuotedPhotoIdentity & {id:string}){return downloadSchema.parse(await this.command('start-quoted-download',{photo}));}
  async quotedDownloadStatus(downloadId:string){return downloadSchema.parse(await this.command('quoted-download-status',{downloadId}));}
  async cancelQuotedDownload(downloadId:string){return downloadSchema.parse(await this.command('cancel-quoted-download',{downloadId}));}
  async stop(){
    if(this.stopping)return this.stopping;
    const child=this.child;if(!child)return;
    const stopping=new Promise<void>(resolveStop=>{
      const timeout=setTimeout(()=>{child.kill();},12000);
      const done=()=>{clearTimeout(timeout);if(this.child===child)this.child=undefined;resolveStop();};
      child.once('exit',done);
      if(child.exitCode!==null||child.signalCode!==null){done();return;}
      child.stdin.end(JSON.stringify({id:randomUUID(),op:'stop'})+'\n');
    });
    this.stopping=stopping;
    try{await stopping;}finally{if(this.stopping===stopping)this.stopping=undefined;}
  }
}
