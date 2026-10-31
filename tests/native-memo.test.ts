import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeMemoAdapter,type MemoInbox,MEMO_TEST_PREFIX} from '../src/adapters/wechat/native/memo-adapter.js';
import type {NativeBridgePort,NativeOutcome} from '../src/adapters/wechat/native/bridge.js';
import {incomingSchema,type Incoming} from '../src/schema.js';
import {createApplication} from '../src/core/application.js';
import {environmentSchema} from '../src/config/environment.js';
class Inbox implements MemoInbox {
  sessions=[{id:'memo',kind:'private',name:'备忘录'}];
  status={running:false,baselines:0,error:null};
  handlers=new Set<(m:Incoming)=>void>();closed=false;watched:string[]=[];
  start(){this.status.running=true;}
  watch(ids:string[]){this.watched=ids;this.status.baselines=1;}
  async close(){this.closed=true;this.status.running=false;}
  onMessage(handler:(m:Incoming)=>void){this.handlers.add(handler);return ()=>this.handlers.delete(handler);}
  emit(text:string,extra:Partial<Incoming>={}){for(const h of this.handlers)h(incomingSchema.parse({id:'123',kind:'private',conversationId:'memo',senderId:'self',isSelf:true,text,timestamp:Date.now(),...extra}));}
}
class Bridge implements NativeBridgePort {
  stopped=false;calls=0;
  outcome:()=>Promise<NativeOutcome>=async()=>({attempted:true,nativeReturned:true});
  async start(){}
  async stop(){this.stopped=true;}
  async status(){return {ready:true,busy:false,expiresAt:Date.now()+300000};}
  async send(){this.calls++;return this.outcome();}
}
async function fixture(){const inbox=new Inbox(),bridge=new Bridge(),adapter=new NativeMemoAdapter('memo',bridge,inbox,30);await adapter.connect();return {inbox,bridge,adapter};}
test('native memo admits only explicit self-test input in exact scope; no outbound echo loop',async()=>{
  const {inbox,bridge,adapter}=await fixture();const received:Incoming[]=[];adapter.onMessage(m=>received.push(m));
  try{
    inbox.emit('ordinary');inbox.emit(MEMO_TEST_PREFIX+'hello',{conversationId:'other'});inbox.emit(MEMO_TEST_PREFIX+'hello',{kind:'group'});inbox.emit(MEMO_TEST_PREFIX+'hello',{isSelf:false});inbox.emit(MEMO_TEST_PREFIX+' ');
    inbox.emit(MEMO_TEST_PREFIX+' hello');assert.equal(received.length,1);assert.equal(received[0]!.text,'hello');assert.equal(received[0]!.isSelf,false);assert.match(received[0]!.source,/self-test/);
    assert.deepEqual(inbox.watched,['memo']);assert.equal((await adapter.sendText('other','no')).status,'not-sent');assert.equal((await adapter.sendText('memo',MEMO_TEST_PREFIX+'loop')).status,'not-sent');assert.equal((await adapter.sendImage()).status,'not-sent');assert.equal(bridge.calls,0);
  }finally{await adapter.disconnect();}assert.equal(inbox.handlers.size,0);assert.equal(inbox.closed,true);assert.equal(bridge.stopped,true);
});
test('early database receipt confirms send while in-flight lock prevents another call',async()=>{
  const {inbox,bridge,adapter}=await fixture();let release!:(v:NativeOutcome)=>void;
  bridge.outcome=()=>new Promise(resolve=>{release=resolve;});
  try{const sending=adapter.sendText('memo','native reply');inbox.emit('native reply');assert.equal((await adapter.sendText('memo','second')).status,'not-sent');release({attempted:true,nativeReturned:true});assert.equal((await sending).status,'sent');assert.equal(bridge.calls,1);}finally{await adapter.disconnect();}
});
test('native return without fresh server ID is unknown; transport failures never claim success',async()=>{
  const {inbox,bridge,adapter}=await fixture();
  try{
    const pending=adapter.sendText('memo','reply');inbox.emit('reply',{id:'0'});inbox.emit('reply',{id:'temp-id'});inbox.emit('reply',{conversationId:'other'});assert.equal((await pending).status,'unknown');
    bridge.outcome=async()=>{throw Error('pipe failed');};assert.equal((await adapter.sendText('memo','reply2')).status,'unknown');
    bridge.outcome=async()=>({attempted:false,error:'expired warmup'});assert.equal((await adapter.sendText('memo','reply3')).status,'not-sent');
    bridge.outcome=async()=>({attempted:true,nativeReturned:true,cleanupError:true});assert.equal((await adapter.sendText('memo','reply4')).status,'unknown');
  }finally{await adapter.disconnect();}
});
test('disconnect resolves outstanding receipt and invalid memo fails closed',async()=>{
  const {adapter}=await fixture();const pending=adapter.sendText('memo','pending');await adapter.disconnect();assert.equal((await pending).status,'unknown');
  const inbox=new Inbox(),bridge=new Bridge();inbox.sessions[0]!.id='wrong';const invalid=new NativeMemoAdapter('memo',bridge,inbox,10);
  await assert.rejects(invalid.connect(),/verified private memo/);assert.equal(inbox.closed,true);assert.equal(bridge.stopped,true);
});
test('application uses injected backend and retains dry-run transport protection',async()=>{
  const inbox=new Inbox(),bridge=new Bridge(),adapter=new NativeMemoAdapter('memo',bridge,inbox,30);
  const env=environmentSchema.parse({INGEST_TOKEN:'native-memo-test-token-123456',DB_PATH:':memory:',TEST_SCOPES:'[["private","memo"]]',DRY_RUN:'true'});
  const runtime=await createApplication(env,{async complete(){return '{"text":"测试回复"}';}},adapter);
  try{
    assert.equal((await runtime.app.inject({url:'/health'})).json().adapter.backend,'native-memo-experimental');
    const response=await runtime.app.inject({method:'POST',url:'/ingest',headers:{'x-fishbot-token':env.INGEST_TOKEN},payload:incomingSchema.parse({id:'1',kind:'private',conversationId:'memo',senderId:'test',text:'hello',timestamp:Date.now()})});
    assert.equal(response.json().backend,'native-memo-experimental');assert.equal(response.json().accepted,true);await runtime.engine.idle();assert.equal(runtime.store.db.prepare('SELECT status FROM outbox').get()!.status,'dry-run');assert.equal(bridge.calls,0);
  }finally{await runtime.app.close();}assert.equal(bridge.stopped,true);assert.equal(inbox.closed,true);
});
