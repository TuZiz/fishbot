import type { WechatAdapter } from '../adapters/wechat/contract.js';
import { Store } from '../storage/store.js';
export class Delivery {
  paused = false;
  private running = false;
  private settled:Promise<void>=Promise.resolve();
  private resolveSettled:()=>void=()=>{};
  constructor(private store: Store, private adapter: WechatAdapter, private dryRun: boolean, private allowed: Set<string>,private policy:(scope:string)=>boolean=()=>true) {}
  async flush() {
    if (this.running || this.paused) return;
    this.running = true;
    this.settled=new Promise<void>(resolve=>{this.resolveSettled=resolve;});
    try {
      for (const job of this.store.pending()) {
        if (this.paused) break;
        if (!this.allowed.has(job.scope)||!this.policy(job.scope)) continue;
        const created=Number(this.store.db.prepare('SELECT created FROM outbox WHERE id=?').get(job.id)?.created??0);
        if(Date.now()-created>60000){this.store.complete(job.id,'expired',{reason:'reply expired'});continue;}
        if (!this.store.claim(job.id)) continue;
        if (this.dryRun) { this.store.complete(job.id,'dry-run',{ reason: 'transport not called' }); continue; }
        try {
          let timer:NodeJS.Timeout|undefined;
          const result=await Promise.race([job.kind==='image'?this.adapter.sendImage(job.target,job.text):this.adapter.sendText(job.target,job.text),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('send timeout')),15000);})]).finally(()=>clearTimeout(timer));
          if(result.status==='not-sent')this.store.retryKnownFailure(job.id,result);else this.store.complete(job.id,result.status,result);
        } catch {
          this.store.complete(job.id,'unknown',{ reason: 'transport threw; manual reconciliation required' });
        }
      }
    } finally { this.running = false;this.resolveSettled(); }
  }
  async close(){this.paused=true;await this.settled;}
}
