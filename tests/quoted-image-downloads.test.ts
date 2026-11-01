import test from 'node:test';
import assert from 'node:assert/strict';
import {QuotedImageDownloads} from '../src/adapters/wechat/database/quoted-image-downloads.js';
import type {NativeBridgePort,QuotedDownloadResult} from '../src/adapters/wechat/native/bridge.js';

const photo={conversationId:'synthetic@chatroom',senderId:'friend',serverId:'9007199254740999',localId:1,md5:'0123456789abcdef0123456789abcdef'};
function fixture(){
 let starts=0,cancels=0,id='';
 const bridge:NativeBridgePort={start:async()=>{},stop:async()=>{},status:async()=>({ready:true,busy:false,expiresAt:0,quotedDownloadsSupported:true}),send:async()=>({attempted:false}),
  startQuotedDownload:async p=>{starts++;id=p.id;return {id,state:'pending'};},
  quotedDownloadStatus:async()=>({id,state:'complete',kind:2,released:true}),
  cancelQuotedDownload:async v=>{cancels++;return {id:v,state:'cancelled',released:true};}};
 return {bridge,counts:()=>({starts,cancels})};
}
test('single photo completes, excludes thumbnails and suppresses repeated native requests',async()=>{
 const f=fixture(),resolver=new QuotedImageDownloads(f.bridge,100,1),signal=new AbortController().signal;
 assert.equal(await resolver.fetch(photo,signal),true);
 assert.equal(await resolver.fetch(photo,signal),false);
 assert.deepEqual(f.counts(),{starts:1,cancels:0});
 const g=fixture();g.bridge.quotedDownloadStatus=async id=>({id,state:'complete',kind:1,released:true});
 assert.equal(await new QuotedImageDownloads(g.bridge,100,1).fetch(photo,signal),false);
});
test('abort and timeout cancel without retry, native transport remains independently usable',async()=>{
 for(const abort of [true,false]){
  const f=fixture(),controller=new AbortController();
  f.bridge.quotedDownloadStatus=async id=>({id,state:'pending'});
  if(abort){const start=f.bridge.startQuotedDownload!;f.bridge.startQuotedDownload=async p=>{const r=await start(p);controller.abort();return r;};}
  await assert.rejects(new QuotedImageDownloads(f.bridge,4,1).fetch(photo,controller.signal));
  assert.deepEqual(f.counts(),{starts:1,cancels:1});
  assert.equal((await f.bridge.send('other','synthetic')).attempted,false);
 }
});
test('uncertain start is cancelled once and not retried; capability gate does not call native',async()=>{
 const f=fixture();f.bridge.startQuotedDownload=async()=>{throw Error('synthetic IPC loss');};
 const resolver=new QuotedImageDownloads(f.bridge,100,1),signal=new AbortController().signal;
 await assert.rejects(resolver.fetch(photo,signal),/IPC loss/);
 assert.equal(f.counts().cancels,1);assert.equal(await resolver.fetch(photo,signal),false);
 const g=fixture();g.bridge.status=async()=>({ready:true,busy:false,expiresAt:0});
 assert.equal(await new QuotedImageDownloads(g.bridge).fetch(photo,signal),false);assert.equal(g.counts().starts,0);
});
test('global concurrency one and an unrelated returned task ID cannot be used',async()=>{
 const f=fixture();let release!:(r:QuotedDownloadResult)=>void,started!:()=>void;
 const gate=new Promise<void>(r=>started=r);
 f.bridge.startQuotedDownload=async()=>{started();return new Promise(r=>release=r);};
 const resolver=new QuotedImageDownloads(f.bridge,100,1),signal=new AbortController().signal;
 const first=resolver.fetch(photo,signal);await gate;
 assert.equal(await resolver.fetch({...photo,serverId:'2'},signal),false);
 release({id:'wrong',state:'pending'});
 await assert.rejects(first,/identity changed/);assert.equal(f.counts().cancels,1);
});
