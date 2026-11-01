import { unlink } from 'node:fs/promises';
import type { Store } from '../storage/store.js';
import type { Incoming } from '../schema.js';
import type { ImageGenerator } from './client.js';
import type {ImageReferences} from './references.js';

interface ImageWork {
  store:Store; message:Incoming; scope:string; intent:{prompt:string;edit:boolean};
  generator?:ImageGenerator; canSendImages:boolean; signal:AbortSignal;
  references?:ImageReferences;
  transportReady?:()=>Promise<boolean>;
  flush:()=>Promise<void>;
  beforePaid?:()=>boolean;
  active:()=>boolean; onError:(error:unknown,scope:string)=>void;
}
// Owns paid-request deduplication and generated-file disposal. Transport remains in Delivery.
export async function enqueueImageReply(work:ImageWork):Promise<void> {
  const {store,message:m,scope,intent,generator,canSendImages,signal,active,onError,references,transportReady}=work;
  let feedback:string|undefined;
  if(!intent.prompt)feedback='请在“生图”后写上想画的内容，例如：生图 一只在海边晒太阳的猫。';
  else if(intent.edit&&!m.quote)feedback='请引用一张图片，再说明希望怎样美化。';
  else if(!generator)feedback='生图 API 尚未配置。';
  else if(!canSendImages||await transportReady?.()===false)feedback='当前微信原生通道尚未支持图片发送，暂时无法回传生成图片。';
  else {
    if(!active())return;
    store.db.exec('CREATE TABLE IF NOT EXISTS image_requests(scope TEXT NOT NULL,incoming TEXT NOT NULL,PRIMARY KEY(scope,incoming))');
    if(!store.db.prepare('INSERT OR IGNORE INTO image_requests VALUES(?,?)').run(scope,m.id).changes)return;
    const waitingId=m.id+':image-wait';
    store.enqueue({...m,id:waitingId},intent.edit?'收到，稍等，我来处理这张图。':'收到，稍等，我来画。');
    await work.flush();
    if(!active())return;
    if(store.db.prepare('SELECT status FROM outbox WHERE scope=? AND incoming=?').get(scope,waitingId)?.status!=='sent'){
      store.db.prepare("UPDATE outbox SET status='cancelled' WHERE scope=? AND incoming=? AND status='pending'").run(scope,waitingId);
      onError(new Error('Image waiting acknowledgement not confirmed; provider not called'),scope);return;
    }
    let reference;
    try{reference=intent.edit?await references?.resolve(m,signal):undefined;}
    catch(error){if(signal.aborted)throw error;onError(error,scope);if(active())store.enqueue(m,'这张引用图片暂时未能加载，可能已过期或下载失败。没有调用改图，请稍后重新引用，或在服务器微信加载原图后再试。');return;}
    if(intent.edit&&!reference){if(active())store.enqueue(m,'暂时无法取得这张引用图片的清晰图，只有缩略图不能编辑。没有调用改图；可在服务器微信加载原图后重新引用再试。');return;}
    if(!active())return;
    if(work.beforePaid&&!work.beforePaid())return;
    let path:string|undefined;
    try{path=await generator.generate({prompt:intent.prompt,reference},signal);if(active())store.enqueue(m,path,'image');else await unlink(path);}
    catch(error){if(signal.aborted)throw error;onError(error,scope);feedback='生图未完成，请稍后再试；本次不会自动重复请求。';}
  }
  if(feedback&&active())store.enqueue(m,feedback);
}
