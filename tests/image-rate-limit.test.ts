import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store,scopeOf} from '../src/storage/store.js';
import {ImageRateLimit} from '../src/images/rate-limit.js';
import {settingsSchema} from '../src/config/settings.js';
import {incomingSchema} from '../src/schema.js';
import {createApplication} from '../src/core/application.js';
import {environmentSchema} from '../src/config/environment.js';

const message=(id:string,conversationId='p',senderId='u')=>incomingSchema.parse({id,conversationId,senderId,kind:'private',text:'生图 猫',timestamp:Date.now()});
const settings=settingsSchema.parse({});

test('image cooldown and prompt/reference deduplication persist across restarts without storing prompts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fishbot-image-limits-')),path=join(dir,'limits.sqlite');let store=new Store(path);
 const m=message('first'),scope=scopeOf(m),intent={prompt:'猫',edit:false},now=1000000;
 try{
  let gate=new ImageRateLimit(store);assert.equal(gate.start(scope,m,intent,settings,now),undefined);
  assert.equal(gate.check(scope,message('next'),{prompt:'狗',edit:false},settings,now+1000)?.reason,'cooldown');
  assert.equal(gate.check(scope,message('next'),intent,settings,now+60001)?.reason,'duplicate');
  store.close();store=new Store(path);gate=new ImageRateLimit(store);
  assert.equal(gate.check(scope,message('next'),intent,settings,now+60001)?.reason,'duplicate');
  assert.equal(gate.check(scope,message('next'),{prompt:'狗',edit:false},settings,now+60001),undefined);
  assert.equal(gate.check(scope,message('next'),intent,settings,now+300001),undefined);
  const other=message('elsewhere','other');assert.equal(gate.check(scopeOf(other),other,intent,settings,now+1000)?.reason,'cooldown');
  const independent=message('independent','other','other-user');assert.equal(gate.check(scopeOf(independent),independent,intent,settings,now+1000),undefined);
  assert.doesNotMatch(JSON.stringify(store.db.prepare('SELECT * FROM image_rate_requests').all()),/猫/);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('reference identities and edit prompts distinguish allowed requests after cooldown',()=>{
 const store=new Store(':memory:');try{
  const gate=new ImageRateLimit(store),m={...message('edit'),quote:{type:3,senderId:'u',messageId:'123'}},scope=scopeOf(m),intent={prompt:'背景换成火星',edit:true},now=1000000;
  gate.start(scope,m,intent,settings,now);
  assert.equal(gate.check(scope,{...m,id:'edit-again'},intent,settings,now+61000)?.reason,'duplicate');
  assert.equal(gate.check(scope,{...m,id:'other-image',quote:{...m.quote,messageId:'124'}},intent,settings,now+61000),undefined);
  assert.equal(gate.check(scope,{...m,id:'other-prompt'},{prompt:'背景换成月球',edit:true},settings,now+61000),undefined);
  assert.equal(gate.notify(scope,'u',now),true);assert.equal(gate.notify(scope,'u',now+1000),false);assert.equal(gate.notify(scope,'u',now+15000),true);
 }finally{store.close();}
});

test('rapid new image messages neither abort the original provider nor trigger additional paid work',async()=>{
 const r=await createApplication(environmentSchema.parse({INGEST_TOKEN:'image-limit-test-token-long-enough',DB_PATH:':memory:',TEST_SCOPES:'[["private","p"]]',DRY_RUN:'false'}));
 const dir=await mkdtemp(join(tmpdir(),'fishbot-image-busy-')),path=join(dir,'result.png');await writeFile(path,Buffer.from([137,80,78,71,13,10,26,10,0]));
 let started!:()=>void,complete!:(path:string)=>void;const ready=new Promise<void>(resolve=>started=resolve);let paid=0,providerSignal:AbortSignal|undefined;
 r.settings.save({...r.settings.get(),mergeMs:10});r.engine.imageGenerator={generate:async(_request,signal)=>{paid++;providerSignal=signal;started();return new Promise<string>(resolve=>complete=resolve);}};
 try{
  r.adapter.receive(message('first'));await ready;
  r.adapter.receive(message('repeat1'));r.adapter.receive(message('repeat2'));r.adapter.receive(message('repeat1'));
  assert.equal(providerSignal!.aborted,false);assert.equal(paid,1);
  complete(path);await r.engine.idle();await r.delivery.flush();
  assert.equal(r.adapter.sent.filter(v=>v.kind==='image').length,1);
  assert.equal(r.adapter.sent.filter(v=>v.kind==='text'&&v.content.includes('重复发送不会加速')).length,1);
  r.adapter.receive({...message('after-finish'),text:'生图 狗'});await r.engine.idle();await r.delivery.flush();assert.equal(paid,1);
 }finally{complete?.(path);await r.app.close();await rm(dir,{recursive:true,force:true});}
});

test('repeated images during merge retain the first request rather than replacing it',async()=>{
 const r=await createApplication(environmentSchema.parse({INGEST_TOKEN:'image-merge-limit-token-long-enough',DB_PATH:':memory:',TEST_SCOPES:'[["private","p"]]',DRY_RUN:'false'}));
 let paid=0;r.settings.save({...r.settings.get(),mergeMs:30});r.engine.imageGenerator={generate:async()=>{paid++;throw Error('synthetic provider failure');}};
 try{
  r.adapter.receive(message('first'));r.adapter.receive(message('rapid-second'));await r.engine.idle();
  assert.equal(paid,1);
  const start=r.store.db.prepare('SELECT incoming FROM image_rate_requests').get();assert.equal(start?.incoming,'first');
 }finally{await r.app.close();}
});
