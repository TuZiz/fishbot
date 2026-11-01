import type { WechatAdapter } from '../adapters/wechat/contract.js';
import { Store } from '../storage/store.js';
import type {ActivitySink} from '../monitoring/activity.js';
export class Delivery {
  activity:ActivitySink=()=>{};
  paused = false;
  private running = false;
  private settled:Promise<void>=Promise.resolve();
  private resolveSettled:()=>void=()=>{};
  constructor(private store: Store, private adapter: WechatAdapter, private dryRun: boolean, private allowed: Set<string>,private policy:(scope:string)=>boolean=()=>true) {}
  async flush():Promise<void> {
    if(this.running){await this.settled;return this.flush();}
    if (this.paused) return;
    this.running = true;
    this.settled=new Promise<void>(resolve=>{this.resolveSettled=resolve;});
    try {
      for (const job of this.store.pending()) {
        if (this.paused) break;
        if (!this.allowed.has(job.scope)||!this.policy(job.scope)) continue;
        const created=Number(this.store.db.prepare('SELECT created FROM outbox WHERE id=?').get(job.id)?.created??0);
        if(Date.now()-created>60000){this.store.complete(job.id,'expired',{reason:'reply expired'});this.activity({stage:'expired',scope:job.scope});continue;}
        if (!this.store.claim(job.id)) continue;
        if (this.dryRun) { this.store.complete(job.id,'dry-run',{ reason: 'transport not called' });this.activity({stage:'dry-run',scope:job.scope,text:job.text,kind:job.kind}); continue; }
        this.activity({stage:'sending',scope:job.scope,text:job.text,kind:job.kind});
        try {
          let timer:NodeJS.Timeout|undefined;
          const result=await Promise.race([job.kind==='image'?this.adapter.sendImage(job.target,job.text):this.adapter.sendText(job.target,job.text),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('send timeout')),job.kind==='image'?60000:15000);})]).finally(()=>clearTimeout(timer));
          if(result.status==='not-sent')this.store.retryKnownFailure(job.id,result);else this.store.complete(job.id,result.status,result);
          this.activity({stage:result.status,scope:job.scope,messageId:result.messageId});
        } catch {
          this.store.complete(job.id,'unknown',{ reason: 'transport threw; manual reconciliation required' });
          this.activity({stage:'unknown',scope:job.scope});
        }
      }
    } finally { this.running = false;this.resolveSettled(); }
  }
  async close(){this.paused=true;await this.settled;}
}
