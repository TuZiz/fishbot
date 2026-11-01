import {Worker} from 'node:worker_threads';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {incomingSchema,type Incoming} from '../../../schema.js';
type ObserverEvent={generation?:number}&(
  {type:'healthy'}|{type:'sessions';sessions:{id:string;kind:string;name:string}[]}|
  {type:'baseline';id:string}|{type:'cursor';key:string;value:number;pendingSelf?:number[]}|
  {type:'skipped';count:number}|{type:'failure';reason:string}|{type:'message';message:unknown}
);
interface ObserverWorker {
  on(event:'message',listener:(message:ObserverEvent)=>void):unknown;
  on(event:'error',listener:(error:Error)=>void):unknown;
  on(event:'exit',listener:(code:number)=>void):unknown;
  once(event:'exit',listener:(code:number)=>void):unknown;
  postMessage(message:unknown):void;
  terminate():Promise<number>;
}
export interface DatabaseObserverOptions { storagePath?:string; keyPath?:string }

/** Owns one read-only worker; resumes acknowledged cursors after worker failure. */
export class DatabaseObserver {
  private worker?:ObserverWorker;
  private handlers=new Set<(message:Incoming)=>void>();
  private watchGeneration=0;
  private desired=false;
  private retryTimer?:NodeJS.Timeout;
  private failures=0;
  private watched:string[]=[];
  private cursors:Record<string,number>={};
  private pendingSelf:Record<string,number[]>={};
  private seen=new Set<string>();
  private closing?:Promise<void>;
  private cleanups=new Set<Promise<void>>();
  sessions:{id:string;kind:string;name:string}[]=[];
  events:Incoming[]=[];
  status={running:false,baselines:0,baselineIds:[] as string[],skipped:0,error:null as string|null,recoveryAttempts:0,failureCount:0,lastFailure:null as {at:number;reason:string}|null,readOnly:true,aiForwarding:false,sendingSupported:false};
  private workerFactory:(snapshotRoot:string)=>ObserverWorker;
  constructor(workerFactory:((snapshotRoot:string)=>ObserverWorker)|undefined=undefined,private restartDelayMs=2000,private options:DatabaseObserverOptions={}){
    this.workerFactory=workerFactory??(snapshotRoot=>new Worker(new URL('./worker.js',import.meta.url),{execArgv:[],workerData:{snapshotRoot,storagePath:this.options.storagePath,keyPath:this.options.keyPath}}));
  }
  onMessage(handler:(message:Incoming)=>void){this.handlers.add(handler);return ()=>this.handlers.delete(handler);}
  private resetBaselines(){this.status.baselines=0;this.status.baselineIds=[];}
  private failed(reason:string){this.status.error=reason;this.status.failureCount++;this.status.lastFailure={at:Date.now(),reason};}
  start(){
    if(this.closing)throw Error('Database observer is stopping');
    if(this.desired)return;
    this.desired=true;this.failures=0;this.status.error=null;this.sessions=[];this.events=[];
    this.watched=[];this.cursors={};this.pendingSelf={};this.seen.clear();this.resetBaselines();this.launch();
  }
  private scheduleRecovery(){
    if(!this.desired||this.retryTimer)return;
    this.failures++;this.status.recoveryAttempts++;
    this.retryTimer=setTimeout(()=>{this.retryTimer=undefined;if(this.desired)this.launch();},Math.min(60000,this.restartDelayMs*2**Math.min(this.failures-1,10)));
    this.retryTimer.unref();
  }
  private launch(){
    if(!this.desired||this.worker)return;
    let worker:ObserverWorker;
    // Parent-owned, unique scratch directory: hard worker failure cannot orphan
    // decrypted snapshots. Never delete a shared TEMP directory or a source DB.
    const snapshotRoot=join(tmpdir(),'fishbot-inbox-'+randomUUID());
    try{worker=this.workerFactory(snapshotRoot);}catch{this.failed('Database worker could not start');this.status.running=false;this.scheduleRecovery();return;}
    this.worker=worker;this.status.running=true;this.resetBaselines();
    worker.on('message',m=>{
      if(this.worker!==worker||!this.desired)return;
      if(m.generation!==undefined&&m.generation!==this.watchGeneration)return;
      if(m.type==='healthy'){this.status.error=null;this.failures=0;}
      if(m.type==='sessions')this.sessions=m.sessions;
      if(m.type==='baseline'&&this.watched.includes(m.id)){
        this.status.baselines++;if(!this.status.baselineIds.includes(m.id))this.status.baselineIds.push(m.id);
      }
      if(m.type==='cursor'&&typeof m.key==='string'&&Number.isSafeInteger(m.value)&&m.value>=0){
        this.cursors[m.key]=m.value;
        if(Array.isArray(m.pendingSelf)&&m.pendingSelf.length<=200&&m.pendingSelf.every(id=>Number.isSafeInteger(id)&&id>0)){
          if(m.pendingSelf.length)this.pendingSelf[m.key]=[...m.pendingSelf];else delete this.pendingSelf[m.key];
        }
      }
      if(m.type==='skipped')this.status.skipped+=m.count;
      if(m.type==='failure')this.failed(m.reason);
      if(m.type==='message'){
        const parsed=incomingSchema.safeParse(m.message);
        if(!parsed.success){this.failed('Invalid database worker message');return;}
        const message=parsed.data;if(!this.watched.includes(message.conversationId))return;
        const key=JSON.stringify([message.kind,message.conversationId,message.id]);
        if(this.seen.has(key))return;
        this.seen.add(key);if(this.seen.size>2000)this.seen.delete(this.seen.values().next().value!);
        this.events.push(message);if(this.events.length>20)this.events.shift();
        for(const handler of this.handlers)handler(message);
      }
    });
    worker.on('error',()=>{if(this.worker===worker){this.failed('Database worker failed; recovery pending');this.status.running=false;void worker.terminate();}});
    worker.on('exit',()=>{if(this.worker===worker){
      this.worker=undefined;this.status.running=false;this.resetBaselines();
      if(this.desired){if(!this.status.error)this.failed('Database worker exited; recovery pending');else this.status.error='Database worker exited; recovery pending';}
      const cleanup=rm(snapshotRoot,{recursive:true,force:true,maxRetries:3,retryDelay:100}).then(()=>{if(this.desired)this.scheduleRecovery();}).catch(()=>{
        this.failed('Temporary snapshot cleanup failed; automatic worker restart blocked');
      }).finally(()=>{this.cleanups.delete(cleanup);});this.cleanups.add(cleanup);
    }});
    if(this.watched.length)worker.postMessage({type:'watch',scopes:this.watched,generation:this.watchGeneration,cursors:{...this.cursors},...(Object.keys(this.pendingSelf).length?{pendingSelf:structuredClone(this.pendingSelf)}:{})});
  }
  watch(ids:string[]){
    if(!this.worker||!this.desired)throw new Error('Observer not running');
    this.watched=[...ids];this.events=[];this.cursors={};this.pendingSelf={};this.seen.clear();this.resetBaselines();
    this.worker.postMessage({type:'watch',scopes:this.watched,generation:++this.watchGeneration,cursors:{}});
  }
  close():Promise<void>{
    if(this.closing)return this.closing;
    this.desired=false;clearTimeout(this.retryTimer);this.retryTimer=undefined;this.status.running=false;
    const worker=this.worker;
    this.closing=(async()=>{
      if(worker)await new Promise<void>(resolve=>{
        const timeout=setTimeout(()=>{void worker.terminate().finally(resolve);},10000);
        worker.once('exit',()=>{clearTimeout(timeout);resolve();});worker.postMessage({type:'stop'});
      });
      if(this.worker===worker)this.worker=undefined;
      await Promise.all(this.cleanups);
      this.events=[];this.resetBaselines();
    })().finally(()=>{this.closing=undefined;});
    return this.closing;
  }
}
