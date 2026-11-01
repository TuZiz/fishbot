import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApplication} from '../src/core/application.js';
import {environmentSchema} from '../src/config/environment.js';
import {MockAdapter} from '../src/adapters/mock/adapter.js';
test('late generated image is deleted after pause even when provider ignores abort',async()=>{
 const r=await createApplication(environmentSchema.parse({INGEST_TOKEN:'image-cancel-token-long-enough',DB_PATH:':memory:',TEST_SCOPES:'[["private","p"]]',DRY_RUN:'false'}));
 const dir=await mkdtemp(join(tmpdir(),'fishbot-late-')),path=join(dir,'late.png');await writeFile(path,'test');
 let started!:()=>void,complete!:(v:string)=>void;const ready=new Promise<void>(resolve=>started=resolve);
 r.settings.save({...r.settings.get(),mergeMs:10});r.engine.imageGenerator={generate:async()=>{started();return new Promise<string>(resolve=>complete=resolve);}};
 try{r.adapter.receive({id:'late',kind:'private',conversationId:'p',senderId:'u',text:'画一张猫',timestamp:Date.now()});await ready;r.settings.save({...r.settings.get(),paused:true});r.engine.invalidate();complete(path);await r.engine.idle();assert.equal(r.adapter.sent.length,1);assert.match(r.adapter.sent[0]!.content,/稍等/);await assert.rejects(access(path));}
 finally{await r.app.close();await rm(dir,{recursive:true,force:true});}
});

test('pause cancels original-image lookup before any paid image request',async()=>{
 let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);let paid=0,aborted=false;
 const fallback={resolve:async(_message:unknown,signal?:AbortSignal)=>new Promise<undefined>((_resolve,reject)=>{started();signal!.addEventListener('abort',()=>{aborted=true;reject(signal!.reason);},{once:true});})};
 const r=await createApplication(environmentSchema.parse({INGEST_TOKEN:'image-cancel-token-long-enough',DB_PATH:':memory:',TEST_SCOPES:'[["private","p"]]',DRY_RUN:'false'}),undefined,new MockAdapter(),fallback);
 r.settings.save({...r.settings.get(),mergeMs:10});r.engine.imageGenerator={generate:async()=>{paid++;throw Error('Must not reach provider');}};
 try{
  r.adapter.receive({id:'quote-cancel',kind:'private',conversationId:'p',senderId:'u',text:'美化引用的图片，改成绿色',timestamp:Date.now(),quote:{type:3,senderId:'u',messageId:'123'}});
  await ready;r.settings.save({...r.settings.get(),paused:true});r.engine.invalidate();await r.engine.idle();
  assert.equal(aborted,true);assert.equal(paid,0);assert.equal(r.adapter.sent.length,1);
  assert.match(r.adapter.sent[0]!.content,/稍等/);
 }finally{await r.app.close();}
});
