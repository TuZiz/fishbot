import { z } from 'zod';
import { setTimeout as delay } from 'node:timers/promises';
export interface Completion { system:string; input:string; model:string; temperature:number; maxTokens:number; json?:boolean }
export interface ModelClient { complete(request:Completion, signal?:AbortSignal):Promise<string> }
const responseSchema=z.object({choices:z.array(z.object({message:z.object({content:z.string().min(1)}),finish_reason:z.string().nullable().optional()})).min(1),usage:z.object({prompt_tokens:z.number(),completion_tokens:z.number(),total_tokens:z.number()}).optional()});
export class DeepSeekClient implements ModelClient {
  private tail:Promise<unknown>=Promise.resolve();
  private lastCall=0;
  private queued=0;
  constructor(private key:string|undefined,private usage:(value:unknown)=>void,private options={url:'https://api.deepseek.com/chat/completions',timeoutMs:30000,retries:2,minIntervalMs:500}) {}
  complete(request:Completion,signal?:AbortSignal):Promise<string> {
    if(this.queued>=100)return Promise.reject(new Error('AI queue capacity exceeded'));
    this.queued++;const task=this.tail.catch(()=>{}).then(()=>this.perform(request,signal)).finally(()=>{this.queued--;});this.tail=task;return task;
  }
  private async perform(r:Completion,signal?:AbortSignal):Promise<string> {
    if(!this.key)throw new Error('DEEPSEEK_API_KEY is not configured');
    for(let attempt=0;;attempt++) {
      signal?.throwIfAborted();
      await delay(Math.max(0,this.lastCall+this.options.minIntervalMs-Date.now()),undefined,{signal});
      this.lastCall=Date.now();
      const combined=AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs),...(signal?[signal]:[])]);
      let retry=false;let wait=500*2**attempt;
      try {
        const response=await fetch(this.options.url,{method:'POST',signal:combined,headers:{Authorization:`Bearer ${this.key}`,'Content-Type':'application/json'},body:JSON.stringify({model:r.model,messages:[{role:'system',content:r.system},{role:'user',content:r.input}],temperature:r.temperature,max_tokens:r.maxTokens,thinking:{type:'disabled'},stream:false,...(r.json?{response_format:{type:'json_object'}}:{})})});
        if(!response.ok){
          retry=response.status===429||response.status>=500;
          const seconds=Number(response.headers.get('retry-after'));if(Number.isFinite(seconds))wait=Math.min(30000,Math.max(wait,seconds*1000));
          await response.body?.cancel();
          throw new Error(`DeepSeek HTTP ${response.status}`);
        }
        const data=responseSchema.parse(await response.json());
        if(data.usage)this.usage({model:r.model,...data.usage});
        if(data.choices[0]!.finish_reason==='length')throw new Error('DeepSeek output truncated');
        const content=data.choices[0]!.message.content.trim();if(!content)throw new Error('DeepSeek empty response');
        return content;
      } catch(error) {
        if(signal?.aborted)throw error;
        retry ||= error instanceof TypeError || (error instanceof Error && ['TimeoutError','AbortError'].includes(error.name));
        if(!retry||attempt>=this.options.retries)throw error;
        await delay(wait+Math.floor(Math.random()*100),undefined,{signal});
      }
    }
  }
}
