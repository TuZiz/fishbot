import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import type {ImageReferences} from '../../../images/references.js';
import type {Incoming} from '../../../schema.js';
import type {NativeBridgePort} from '../native/bridge.js';
import type {DatabaseObserverOptions} from './observer.js';
import {normalizeCachedImage} from '../../../images/cached-format.js';
import {QuotedImageDownloads} from './quoted-image-downloads.js';

const resultSchema=z.object({md5:z.string().regex(/^[a-f0-9]{32}$/).optional(),candidates:z.array(z.string().min(1).max(32768)).max(12),identity:z.object({md5:z.string().regex(/^[a-f0-9]{32}$/),localId:z.number().int().min(1).max(0xffffffff),conversationId:z.string().min(1).max(256),senderId:z.string().min(1).max(256),serverId:z.string().regex(/^[1-9]\d{0,18}$/)}).optional()});
/** Owns bounded, disposable read-only snapshots. No original image is persisted by this resolver. */
export class CachedImageReferences implements ImageReferences {
  private stopped=false;
  private shutdown=new AbortController();
  private workers=new Map<Worker,Promise<unknown>>();
  private downloads:QuotedImageDownloads;
  constructor(private bridge:NativeBridgePort,private options:DatabaseObserverOptions={},private ffmpegPath?:string){this.downloads=new QuotedImageDownloads(bridge);}
  async resolve(message:Incoming,signal?:AbortSignal):ReturnType<ImageReferences['resolve']>{
    signal=signal?AbortSignal.any([signal,this.shutdown.signal]):this.shutdown.signal;
    signal.throwIfAborted();
    if(this.stopped||message.quote?.type!==3||!this.bridge.readCachedImage)return;
    const {md5,candidates,identity}=await this.snapshot(message,signal);
    const cached=await this.decode(candidates,md5,signal);if(cached)return cached;
    if(identity&&identity.md5===md5&&identity.conversationId===message.conversationId&&identity.senderId===message.quote.senderId&&identity.serverId===message.quote.messageId){
      signal.throwIfAborted();
      if(await this.downloads.fetch(identity,signal)){
        for(let attempt=0;attempt<4;attempt++){
          signal.throwIfAborted();
          const fresh=await this.snapshot(message,signal);
          if(fresh.md5!==md5)throw Error('Quoted photo identity changed during download');
          const image=await this.decode(fresh.candidates,md5,signal);if(image)return image;
          await delay(250,undefined,{signal});
        }
      }
    }
  }
  private async decode(candidates:string[],md5:string|undefined,signal:AbortSignal):ReturnType<ImageReferences['resolve']>{
    for(const path of candidates){
      signal.throwIfAborted();if(this.stopped||!md5)return;
      const encoded=await this.bridge.readCachedImage!(path,md5);if(!encoded)continue;
      const bytes=Buffer.from(encoded,'base64');
      if(!bytes.length||bytes.length>20*1024*1024||createHash('md5').update(bytes).digest('hex')!==md5)continue;
      const image=await normalizeCachedImage(bytes,this.ffmpegPath,signal);
      signal.throwIfAborted();if(image&&!this.stopped)return image;
    }
  }
  private async snapshot(message:Incoming,signal:AbortSignal){
    signal.throwIfAborted();
    if(this.workers.size>=2)throw Error('Image reference lookup busy');
    const scratch=join(tmpdir(),'fishbot-image-'+randomUUID());
    const worker=new Worker(new URL('./image-reference-worker.js',import.meta.url),{execArgv:[],workerData:{scratch,message,...this.options}});
    const task=(async()=>{
      let removeAbort=()=>{};
      try{
        const report=await new Promise<unknown>((resolve,reject)=>{
          const timer=setTimeout(()=>reject(Error('Image reference lookup timeout')),30000);
          const aborted=()=>{clearTimeout(timer);reject(signal!.reason);};
          signal?.addEventListener('abort',aborted,{once:true});
          removeAbort=()=>signal?.removeEventListener('abort',aborted);
          if(signal?.aborted)aborted();
          worker.once('message',v=>{clearTimeout(timer);resolve(v);});
          worker.once('error',()=>{clearTimeout(timer);reject(Error('Image reference worker failed'));});
          worker.once('exit',()=>{clearTimeout(timer);reject(Error('Image reference worker exited'));});
        });
        removeAbort();signal?.throwIfAborted();
        return resultSchema.parse(report);
      }finally{removeAbort();await worker.terminate();await rm(scratch,{recursive:true,force:true});}
    })();
    this.workers.set(worker,task);
    try{return await task;}finally{this.workers.delete(worker);}
  }
  async close(){this.stopped=true;this.shutdown.abort();await Promise.allSettled([...this.workers.keys()].map(w=>w.terminate()));await Promise.allSettled(this.workers.values());}
}
