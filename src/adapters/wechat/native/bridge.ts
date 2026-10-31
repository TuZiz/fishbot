import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
export interface NativeOutcome {attempted:boolean;nativeReturned?:boolean;error?:string;cleanupError?:boolean}
export interface NativeBridgePort {
  start():Promise<void>;stop():Promise<void>;
  status():Promise<{ready:boolean;busy:boolean;expiresAt:number}>;
  send(target:string,text:string):Promise<NativeOutcome>;
}
export class NativeMemoBridge implements NativeBridgePort {
  private child?:ChildProcessWithoutNullStreams;
  private pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  constructor(private python:string){}
  async start(){
    if(this.child)return;
    const child=spawn(this.python,['-X','utf8',resolve('native/memo-host.py'),'--enable-native-memo-test'],{cwd:process.cwd(),windowsHide:true,stdio:'pipe'});this.child=child;
    const lines=createInterface({input:child.stdout});
    child.stderr.resume(); // Python host reports sanitized diagnostics over its JSON protocol.
    await new Promise<void>((resolveReady,rejectReady)=>{
      const timeout=setTimeout(()=>rejectReady(new Error('Native bridge startup timeout')),10000);
      const fail=(error:Error)=>{clearTimeout(timeout);rejectReady(error);for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();if(this.child===child){this.child=undefined;child.kill();}};
      child.once('error',()=>fail(new Error('Native bridge process failed')));
      child.once('exit',()=>{if(this.child===child)this.child=undefined;lines.close();fail(new Error('Native bridge exited'));});
      lines.on('line',line=>{try{
        const value=JSON.parse(line);
        if(value.event==='ready'){clearTimeout(timeout);resolveReady();}
        if(value.event==='fatal'||value.event==='agent-error')fail(new Error('Native bridge initialization or agent failure'));
        if(typeof value.id==='string'){const item=this.pending.get(value.id);if(item){this.pending.delete(value.id);clearTimeout(item.timer);if(value.error)item.reject(new Error('Native outcome unavailable'));else item.resolve(value.result);}}
      }catch{fail(new Error('Invalid native bridge protocol'));}});
    }).catch(async error=>{await this.stop();throw error;});
  }
  private command(op:string,payload:Record<string,unknown>={}):Promise<unknown>{
    const child=this.child;if(!child)return Promise.reject(new Error('Native bridge disconnected'));
    return new Promise((resolveResult,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Native command timeout; outcome unknown'));},6500);this.pending.set(id,{resolve:resolveResult,reject,timer});child.stdin.write(JSON.stringify({id,op,...payload})+'\n',error=>{if(error){const item=this.pending.get(id);if(item){clearTimeout(item.timer);this.pending.delete(id);reject(new Error('Native command pipe failed'));}}});});
  }
  async status(){return z.object({ready:z.boolean(),busy:z.boolean(),expiresAt:z.number()}).parse(await this.command('status'));}
  async send(target:string,text:string){const result=z.object({attempted:z.boolean(),nativeReturned:z.boolean().optional(),error:z.string().optional(),cleanupError:z.boolean().optional()}).parse(await this.command('send',{target,text}));if(result.cleanupError)await this.stop();return result;}
  async stop(){const child=this.child;if(!child)return;this.child=undefined;child.stdin.end(JSON.stringify({id:randomUUID(),op:'stop'})+'\n');await new Promise<void>(resolveStop=>{const timeout=setTimeout(()=>{child.kill();},2000);child.once('exit',()=>{clearTimeout(timeout);resolveStop();});if(child.exitCode!==null){clearTimeout(timeout);resolveStop();}});}
}
