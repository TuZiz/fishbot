import {Worker} from 'node:worker_threads';
import {incomingSchema,type Incoming} from '../../../schema.js';
export class DatabaseObserver {
  private worker?:Worker;
  private handlers=new Set<(message:Incoming)=>void>();
  onMessage(handler:(message:Incoming)=>void){this.handlers.add(handler);return ()=>this.handlers.delete(handler);}
  sessions:{id:string;kind:string;name:string}[]=[];
  events:Incoming[]=[];
  status={running:false,baselines:0,skipped:0,error:null as string|null,readOnly:true,aiForwarding:false,sendingSupported:false};
  start(){if(this.worker)return;this.status.error=null;const worker=new Worker(new URL('./worker.js',import.meta.url),{execArgv:[]});this.worker=worker;this.status.running=true;
    worker.on('message',m=>{if(m.type==='healthy')this.status.error=null;if(m.type==='sessions')this.sessions=m.sessions;if(m.type==='baseline')this.status.baselines++;if(m.type==='skipped')this.status.skipped+=m.count;if(m.type==='failure')this.status.error=m.reason;
      if(m.type==='message'){const message=incomingSchema.parse(m.message);this.events.push(message);if(this.events.length>20)this.events.shift();for(const handler of this.handlers)handler(message);}});
    worker.on('error',()=>{this.status.error='Database worker failed';});
    worker.on('exit',()=>{if(this.worker===worker){this.worker=undefined;this.status.running=false;}});
  }
  watch(ids:string[]){if(!this.worker)throw new Error('Observer not running');this.events=[];this.status.baselines=0;this.worker.postMessage({type:'watch',scopes:ids});}
  async close(){const worker=this.worker;if(!worker)return;worker.postMessage({type:'stop'});await new Promise<void>(resolve=>{const timeout=setTimeout(()=>{void worker.terminate().then(()=>resolve());},10000);worker.once('exit',()=>{clearTimeout(timeout);resolve();});});this.events=[];}
}


