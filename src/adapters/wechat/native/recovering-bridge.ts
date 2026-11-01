import type {NativeBridgePort,NativeBridgeStatus,NativeOutcome,QuotedPhotoIdentity} from './bridge.js';

/** Serializes transport ownership. Recovery never retries a send with an uncertain outcome. */
export class RecoveringNativeBridge implements NativeBridgePort {
  private timer?:NodeJS.Timeout;
  private stopped=true;
  private generation=0;
  private starting?:Promise<void>;
  private tail:Promise<unknown>=Promise.resolve();
  private polling?:Promise<void>;
  private sending=false;
  private failures=0;
  private nextAttempt=0;
  private available=false;
  private snapshot:NativeBridgeStatus={ready:false,busy:false,expiresAt:0,state:'stopped'};
  constructor(private transport:NativeBridgePort,private intervalMs=2000,private maxBackoffMs=60000){}
  private serialize<T>(action:()=>Promise<T>):Promise<T>{
    const result=this.tail.then(action);this.tail=result.catch(()=>{});return result;
  }
  private active(generation:number){return !this.stopped&&this.generation===generation;}
  start():Promise<void>{
    if(!this.stopped)return this.starting??Promise.resolve();
    this.stopped=false;const generation=++this.generation;
    const starting=this.serialize(async()=>{
      if(!this.active(generation))return;
      this.nextAttempt=0;await this.inspect(generation);
      if(this.active(generation)){
        this.timer=setInterval(()=>{void this.poll();},this.intervalMs);this.timer.unref();
      }
    });
    this.starting=starting;
    void starting.finally(()=>{if(this.starting===starting)this.starting=undefined;});
    return starting;
  }
  private poll():Promise<void>{
    if(this.stopped||this.sending)return Promise.resolve();
    if(this.polling)return this.polling;
    const generation=this.generation;
    const polling=this.serialize(async()=>{if(this.active(generation))await this.inspect(generation);});
    this.polling=polling;
    void polling.finally(()=>{if(this.polling===polling)this.polling=undefined;});
    return polling;
  }
  private async failed(generation:number){
    this.available=false;this.failures++;
    this.nextAttempt=Date.now()+Math.min(this.maxBackoffMs,this.intervalMs*2**Math.min(this.failures-1,10));
    if(this.active(generation))this.snapshot={ready:false,busy:false,expiresAt:0,state:'backoff',reconnectAttempts:this.failures,nextAttemptAt:this.nextAttempt};
    // Cleanup failure remains visible and cannot escape the heartbeat.
    try{await this.transport.stop();}catch{if(this.active(generation))this.snapshot.state='cleanup-failed';}
  }
  private async inspect(generation:number){
    if(Date.now()<this.nextAttempt)return;
    try{
      if(!this.available){
        this.snapshot={ready:false,busy:false,expiresAt:0,state:'connecting'};
        await this.transport.start();this.available=true;
      }
      if(!this.active(generation))return;
      const current=await this.transport.status();
      if(this.active(generation)){
        this.snapshot={...current,state:current.state??(current.ready?'ready':'context-unavailable')};
        this.failures=0;this.nextAttempt=0;
      }
    }catch{await this.failed(generation);}
  }
  async status(){return {...this.snapshot,ready:!this.stopped&&this.snapshot.ready,busy:this.snapshot.busy||this.sending};}
  async send(target:string,text:string):Promise<NativeOutcome>{
    return this.dispatch(()=>this.transport.send(target,text));
  }
  async sendImage(target:string,path:string,size:number,md5:string):Promise<NativeOutcome>{
    if(!this.transport.sendImage)return {attempted:false,error:'Native images unsupported'};
    return this.dispatch(()=>this.transport.sendImage!(target,path,size,md5));
  }
  async readCachedImage(path:string,md5:string){
    const generation=this.generation;
    return this.serialize(async()=>{
      if(!this.active(generation)||!this.available||!this.transport.readCachedImage)return;
      return this.transport.readCachedImage(path,md5);
    });
  }
  async startQuotedDownload(photo:QuotedPhotoIdentity & {id:string}){
    const generation=this.generation;
    return this.serialize(async()=>{
      if(!this.active(generation)||!this.available||!this.transport.startQuotedDownload)throw Error('Quoted image downloader unavailable');
      return this.transport.startQuotedDownload(photo);
    });
  }
  async quotedDownloadStatus(id:string){
    const generation=this.generation;
    return this.serialize(async()=>{
      if(!this.active(generation)||!this.available||!this.transport.quotedDownloadStatus)throw Error('Quoted image download transport changed');
      return this.transport.quotedDownloadStatus(id);
    });
  }
  async cancelQuotedDownload(id:string){
    return this.serialize(async()=>{
      if(!this.available||!this.transport.cancelQuotedDownload)throw Error('Quoted image download cancellation unavailable');
      return this.transport.cancelQuotedDownload(id);
    });
  }
  private async dispatch(operation:()=>Promise<NativeOutcome>):Promise<NativeOutcome>{
    if(this.stopped||this.sending)return {attempted:false,error:'Native transport stopped or busy'};
    this.sending=true;const generation=this.generation;
    try{return await this.serialize(async()=>{
      if(!this.active(generation))return {attempted:false,error:'Native transport changed before dispatch'};
      await this.inspect(generation);
      if(!this.active(generation)||!this.snapshot.ready)return {attempted:false,error:'Native context not ready; no attempt made'};
      try{
        const current=await this.transport.status();
        if(!this.active(generation)||!current.ready)return {attempted:false,error:'Native context invalidated before dispatch'};
        this.snapshot={...current,state:current.state??'ready'};
        return await operation();
      }catch(error){await this.failed(generation);throw error;}
    });}finally{this.sending=false;}
  }
  stop():Promise<void>{
    this.stopped=true;const generation=++this.generation;
    clearInterval(this.timer);this.timer=undefined;
    return this.serialize(async()=>{
      try{await this.transport.stop();}finally{
        this.available=false;
        if(this.generation===generation)this.snapshot={ready:false,busy:false,expiresAt:0,state:'stopped'};
      }
    });
  }
}
