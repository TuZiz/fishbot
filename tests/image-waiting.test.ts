import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../src/core/application.js';
import {environmentSchema} from '../src/config/environment.js';
import {MockAdapter} from '../src/adapters/mock/adapter.js';
import {imageIntent} from '../src/images/intent.js';

const environment=()=>environmentSchema.parse({INGEST_TOKEN:'image-waiting-test-token-long-enough',DB_PATH:':memory:',TEST_SCOPES:'[["private","p"]]',DRY_RUN:'false'});
const input=(id:string,text:string)=>({id,text,kind:'private',conversationId:'p',senderId:'u',timestamp:Date.now()});

test('quoted image edit imperatives route to editing without treating ordinary discussion as a request',()=>{
 for(const text of ['@机器人 背景换到火星上','@机器人 把这个图片背景改为火星','请把这张照片的背景换成火星','帮我换个背景','去掉水印'])assert.equal(imageIntent(text,true)?.edit,true,text);
 for(const text of ['背景换到火星上','你觉得这张照片怎么样','这个背景真好看','我朋友说背景换到火星很好看'])assert.equal(imageIntent(text),null,text);
 for(const text of ['你觉得这张照片怎么样','这个背景真好看','我朋友说背景换到火星很好看'])assert.equal(imageIntent(text,true),null,text);
});

test('direct quoted-photo transformation routes to editing only with a photo reference',()=>{
 for(const text of ['@机器人 把这个图片改成脚踩地球','请把这张照片变成太空风格','帮我将引用的图片修改为漫画','把图换成黑白风格','将原图给我改为暖色调']){
  assert.equal(imageIntent(text,true)?.edit,true,text);
  assert.equal(imageIntent(text),null,text);
 }
 for(const text of ['我朋友说把这个图片改成漫画好看','你觉得把这张图改成漫画怎么样','这个图片改成漫画会好看吗'])assert.equal(imageIntent(text,true),null,text);
});

test('drawing and natural quoted editing acknowledge before provider and then send the image once',async()=>{
 for(const command of [null,'@机器人 把这个图片改成脚踩地球','把这个图片的猫变成红色 @机器人','给图里的猫戴顶帽子','把照片里的文字改成你好','虚化背景']){
  const edit=command!==null;
  const adapter=new MockAdapter(),bytes=Buffer.from([137,80,78,71,13,10,26,10,0]);
  const r=await createApplication(environment(),{complete:async()=>{throw Error('must not route image request to chat');}},adapter,{resolve:async()=>({bytes,mime:'image/png'})});
  const dir=await mkdtemp(join(tmpdir(),'fishbot-wait-')),path=join(dir,'output.png');await writeFile(path,bytes);
  let started!:()=>void,release!:()=>void;const acknowledgementStarted=new Promise<void>(resolve=>started=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const send=adapter.sendText.bind(adapter);adapter.sendText=async(target,text)=>{started();await gate;return send(target,text);};
  let paid=0;r.settings.save({...r.settings.get(),mergeMs:10});
  r.engine.imageGenerator={generate:async request=>{paid++;assert.equal(adapter.sent.length,1);assert.match(adapter.sent[0]!.content,/稍等/);assert.equal(!!request.reference,edit);return path;}};
  const message={...input('request','生图 海边的猫'),...(command!==null?{text:command,quote:{type:3,messageId:'123',senderId:'u'}}:{})};
  try{
   adapter.receive(message);await acknowledgementStarted;assert.equal(paid,0);release();await r.engine.idle();
   assert.equal(paid,1);assert.deepEqual(adapter.sent.map(v=>v.kind),['text','image']);
   adapter.receive(message);await r.engine.idle();assert.equal(paid,1);assert.equal(adapter.sent.length,2);
  }finally{release();await r.app.close();await rm(dir,{recursive:true,force:true});}
 }
});

test('failed image API sends final failure separately from initial waiting acknowledgement',async()=>{
 const r=await createApplication(environment());r.settings.save({...r.settings.get(),mergeMs:10});
 r.engine.imageGenerator={generate:async()=>{throw Error('synthetic failure');}};
 try{r.adapter.receive(input('failure','画一张猫'));await r.engine.idle();assert.equal(r.adapter.sent.length,2);assert.match(r.adapter.sent[0]!.content,/稍等/);assert.match(r.adapter.sent[1]!.content,/生图未完成/);}
 finally{await r.app.close();}
});

test('ambiguous waiting-text delivery does not start a paid image request or retry the message',async()=>{
 const adapter=new MockAdapter();let sends=0,paid=0;adapter.sendText=async()=>{sends++;return {status:'unknown'};};
 const r=await createApplication(environment(),undefined,adapter);r.settings.save({...r.settings.get(),mergeMs:10});r.engine.imageGenerator={generate:async()=>{paid++;throw Error('must not spend');}};
 try{r.adapter.receive(input('ambiguous','生图 猫'));await r.engine.idle();await r.delivery.flush();assert.equal(sends,1);assert.equal(paid,0);}
 finally{await r.app.close();}
});

test('missing server original acknowledges first then reports failure without paid work',async()=>{
 const r=await createApplication(environment());let paid=0;
 r.settings.save({...r.settings.get(),mergeMs:10});r.engine.imageGenerator={generate:async()=>{paid++;throw Error('must not spend');}};
 try{
  r.adapter.receive({...input('missing-original','把这个图片背景改为火星'),quote:{type:3,messageId:'123',senderId:'u'}});
  await r.engine.idle();assert.equal(paid,0);assert.equal(r.adapter.sent.length,2);
  assert.match(r.adapter.sent[0]!.content,/稍等/);
  assert.match(r.adapter.sent[1]!.content,/服务器微信.*原图/);
 }finally{await r.app.close();}
});

test('unconfirmed editing acknowledgement never resolves or downloads the quoted image',async()=>{
 const adapter=new MockAdapter();let sends=0,resolves=0,paid=0;
 adapter.sendText=async()=>{sends++;return {status:'unknown'};};
 const r=await createApplication(environment(),undefined,adapter,{resolve:async()=>{resolves++;throw Error('must not download');}});
 r.settings.save({...r.settings.get(),mergeMs:10});
 r.engine.imageGenerator={generate:async()=>{paid++;throw Error('must not spend');}};
 try{
  adapter.receive({...input('unconfirmed-edit','把这张图片背景换成火星'),quote:{type:3,messageId:'123',senderId:'u'}});
  await r.engine.idle();await r.delivery.flush();
  assert.deepEqual({sends,resolves,paid},{sends:1,resolves:0,paid:0});
 }finally{await r.app.close();}
});
