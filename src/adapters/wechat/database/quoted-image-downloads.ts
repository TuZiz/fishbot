import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {NativeBridgePort,QuotedPhotoIdentity} from '../native/bridge.js';

/** One bounded native photo task; no retries, URL handling or paid operations. */
export class QuotedImageDownloads {
  private busy=false;
  private recent=new Map<string,number>();
  constructor(private bridge:NativeBridgePort,private timeoutMs=45000,private pollMs=200){}
  async fetch(photo:QuotedPhotoIdentity,signal:AbortSignal):Promise<boolean>{
    signal.throwIfAborted();
    if(!this.bridge.startQuotedDownload||!this.bridge.quotedDownloadStatus||!this.bridge.cancelQuotedDownload)return false;
    const status=await this.bridge.status();
    if(!status.ready||!status.quotedDownloadsSupported)return false;
    const key=JSON.stringify([photo.conversationId,photo.serverId,photo.md5]),now=Date.now();
    for(const [k,until] of this.recent)if(until<=now)this.recent.delete(k);
    if(this.busy||this.recent.has(key))return false;
    this.busy=true;this.recent.set(key,now+60000);
    while(this.recent.size>256)this.recent.delete(this.recent.keys().next().value!);
    const id=randomUUID();let settled=false;
    try{
      signal.throwIfAborted();
      console.info('[FishBot] [引用图片] 缓存未就绪，开始下载这一张引用照片');
      let state=await this.bridge.startQuotedDownload({...photo,id});
      if(state.id!==id)throw Error('Quoted image download identity changed');
      const deadline=Date.now()+this.timeoutMs;
      while(state.state==='pending'){
        signal.throwIfAborted();
        if(Date.now()>=deadline)throw Error('Quoted image download timeout; no retry');
        await delay(this.pollMs,undefined,{signal});
        state=await this.bridge.quotedDownloadStatus(id);
        if(state.id!==id)throw Error('Quoted image download identity changed');
      }
      settled=state.released===true||state.state==='busy';
      signal.throwIfAborted();
      const complete=state.state==='complete'&&state.released===true&&(state.kind===2||state.kind===3);
      console.info(complete?`[FishBot] [引用图片] ${state.kind===3?'原图':'普通清晰图'}下载完成，正在核验缓存`:'[FishBot] [引用图片] 下载未完成，不调用改图 API');
      return complete;
    }finally{
      try{if(!settled)await this.bridge.cancelQuotedDownload(id);}finally{this.busy=false;}
    }
  }
}
