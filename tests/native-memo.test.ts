import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeMemoAdapter,type MemoInbox,MEMO_TEST_PREFIX} from '../src/adapters/wechat/native/memo-adapter.js';
import type {NativeBridgePort,NativeOutcome} from '../src/adapters/wechat/native/bridge.js';
import {incomingSchema,type Incoming} from '../src/schema.js';
import {createApplication} from '../src/core/application.js';
import {environmentSchema} from '../src/config/environment.js';
class Inbox implements MemoInbox {
  sessions=[{id:'memo',kind:'private',name:'备忘录'}];
  status={running:false,baselines:0,baselineIds:[] as string[],error:null as string|null};
  handlers=new Set<(m:Incoming)=>void>();closed=false;watched:string[]=[];
  start(){this.status.running=true;}
  watch(ids:string[]){this.watched=ids;this.status.baselines=ids.length;this.status.baselineIds=[...ids];}
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
test('catalog mode identifies duplicate names by ID, forwards any listed peer and blocks self-test injection',async()=>{
 const inbox=new Inbox(),bridge=new Bridge();inbox.sessions=[{id:'memo',kind:'private',name:'同名'},{id:'other',kind:'private',name:'同名'},{id:'new-group',kind:'group',name:'同名'}];
 const adapter=new NativeMemoAdapter('memo',bridge,inbox,30,[{id:'other',kind:'private',name:'同名',selfTest:false},{id:'new-group',kind:'group',name:'同名',selfTest:false}],false,'同名',true);
 const received:Incoming[]=[];adapter.onMessage(m=>received.push(m));
 try{await adapter.connect();inbox.emit('hello',{conversationId:'other',senderId:'other',isSelf:false});inbox.emit('hello',{conversationId:'new-group',senderId:'member',kind:'group',isSelf:false});inbox.emit(MEMO_TEST_PREFIX+'self');inbox.emit('outside',{conversationId:'unknown',isSelf:false});assert.deepEqual(received.map(m=>m.conversationId),['other','new-group']);assert.deepEqual(inbox.watched,['memo','other','new-group']);}finally{await adapter.disconnect();}
});
test('explicit private target name validates filehelper identity and preserves self-test filtering',async()=>{
  const inbox=new Inbox(),bridge=new Bridge();inbox.sessions=[{id:'filehelper',kind:'private',name:'文件传输助手'}];
  const adapter=new NativeMemoAdapter('filehelper',bridge,inbox,30,[],true,'文件传输助手');
  const received:Incoming[]=[];adapter.onMessage(m=>received.push(m));
  try{await adapter.connect();inbox.emit('ordinary',{conversationId:'filehelper'});inbox.emit(MEMO_TEST_PREFIX+'hello',{conversationId:'filehelper'});assert.equal(received.length,1);assert.equal(received[0]!.text,'hello');assert.deepEqual(inbox.watched,['filehelper']);}finally{await adapter.disconnect();}
});
test('native memo admits only explicit self-test input in exact scope; no outbound echo loop',async()=>{
  const {inbox,bridge,adapter}=await fixture();const received:Incoming[]=[];adapter.onMessage(m=>received.push(m));
  try{
    inbox.emit('ordinary');inbox.emit(MEMO_TEST_PREFIX+'hello',{conversationId:'other'});inbox.emit(MEMO_TEST_PREFIX+'hello',{kind:'group'});inbox.emit(MEMO_TEST_PREFIX+'hello',{isSelf:false});inbox.emit(MEMO_TEST_PREFIX+' ');
    inbox.emit(MEMO_TEST_PREFIX+' hello');assert.equal(received.length,1);assert.equal(received[0]!.text,'hello');assert.equal(received[0]!.isSelf,false);assert.match(received[0]!.source,/self-test/);
    assert.deepEqual(inbox.watched,['memo']);assert.equal((await adapter.sendText('other','no')).status,'not-sent');assert.equal((await adapter.sendText('memo',MEMO_TEST_PREFIX+'loop')).status,'not-sent');assert.equal((await adapter.sendImage('memo','unused.png')).status,'not-sent');assert.equal(bridge.calls,0);
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

test('authorized group retains real member metadata and stays isolated from private self-test',async()=>{
  const inbox=new Inbox(),bridge=new Bridge();
  inbox.sessions.push({id:'group@chatroom',kind:'group',name:'备忘录'});
  const adapter=new NativeMemoAdapter('memo',bridge,inbox,30,[{id:'group@chatroom',kind:'group',name:'备忘录',selfTest:false}]);
  await adapter.connect();const received:Incoming[]=[];adapter.onMessage(m=>received.push(m));
  try{
    inbox.emit('group question',{kind:'group',conversationId:'group@chatroom',senderId:'member-one',isSelf:false,mentionedBot:true,replyToBot:true});
    inbox.emit('own ordinary echo',{kind:'group',conversationId:'group@chatroom'});
    inbox.emit('wrong kind',{conversationId:'group@chatroom',isSelf:false});
    inbox.emit('wrong group',{kind:'group',conversationId:'other@chatroom',isSelf:false});
    inbox.emit('private not a friend',{isSelf:false});
    assert.equal(received.length,1);assert.equal(received[0]!.senderId,'member-one');
    assert.equal(received[0]!.mentionedBot,true);assert.equal(received[0]!.replyToBot,true);
    assert.deepEqual(inbox.watched,['memo','group@chatroom']);
    const sending=adapter.sendText('group@chatroom','same text');
    inbox.emit('same text');let settled=false;void sending.then(()=>{settled=true;});
    await new Promise(r=>setTimeout(r,5));assert.equal(settled,false,'private echo cannot confirm group delivery');
    inbox.emit('same text',{kind:'group',conversationId:'group@chatroom',id:'456'});
    assert.equal((await sending).messageId,'456');
  }finally{await adapter.disconnect();}
});

test('every watched target needs its own baseline and confirmation observer must stay healthy',async()=>{
  const inbox=new Inbox(),bridge=new Bridge();
  inbox.sessions.push({id:'group@chatroom',kind:'group',name:'备忘录'});
  inbox.watch=ids=>{inbox.watched=ids;inbox.status.baselines=2;inbox.status.baselineIds=['memo'];};
  const adapter=new NativeMemoAdapter('memo',bridge,inbox,30,[{id:'group@chatroom',kind:'group',name:'备忘录',selfTest:false}]);
  let connected=false;const connecting=adapter.connect().then(()=>{connected=true;});
  try{
    await new Promise(r=>setTimeout(r,20));assert.equal(connected,false,'two shards of private scope do not establish a group baseline');
    inbox.status.baselineIds.push('group@chatroom');await connecting;
    inbox.status.error='snapshot unavailable';assert.equal((await adapter.sendText('memo','unsafe')).status,'not-sent');
    inbox.status.error=null;inbox.status.running=false;assert.equal((await adapter.sendText('memo','unsafe')).status,'not-sent');
    assert.equal(bridge.calls,0);
  }finally{await adapter.disconnect();}
});

test('same-name groups are refused before a bridge is started',async()=>{
  const inbox=new Inbox(),bridge=new Bridge();
  inbox.sessions.push({id:'first@chatroom',kind:'group',name:'备忘录'},{id:'second@chatroom',kind:'group',name:'备忘录'});
  const adapter=new NativeMemoAdapter('memo',bridge,inbox,30,[{id:'first@chatroom',kind:'group',name:'备忘录',selfTest:false}]);
  await assert.rejects(adapter.connect(),/Ambiguous or changed/);assert.equal(inbox.closed,true);assert.equal(bridge.calls,0);
});

test('explicitly authorized friend mode forwards real incoming and still blocks ordinary own echoes',async()=>{
  const inbox=new Inbox(),bridge=new Bridge(),adapter=new NativeMemoAdapter('memo',bridge,inbox,30,[],false);
  const received:Incoming[]=[];adapter.onMessage(m=>received.push(m));await adapter.connect();
  try{
    inbox.emit('real friend input',{isSelf:false,senderId:'friend',source:'wechat-database'});
    inbox.emit('ordinary outgoing echo');inbox.emit('outside test friend',{isSelf:false,conversationId:'other'});
    assert.equal(received.length,1);assert.equal(received[0]!.senderId,'friend');assert.equal(received[0]!.source,'wechat-database');
  }finally{await adapter.disconnect();}
});


test('native images require matching target, MD5, self flag and a fresh numeric receipt',async()=>{
 const {mkdir,mkdtemp,writeFile,rm}=await import('node:fs/promises');const {resolve,join}=await import('node:path');const {createHash}=await import('node:crypto');
 await mkdir(resolve('data/generated'),{recursive:true});const directory=await mkdtemp(resolve('data/generated/test-image-'));const path=join(directory,'test.png'),bytes=Buffer.from([137,80,78,71,13,10,26,10]);await writeFile(path,bytes);
 const inbox=new Inbox();let imageCalled!:()=>void;const called=new Promise<void>(resolve=>imageCalled=resolve);
 class ImageBridge extends Bridge {
  override async status(){return {...await super.status(),imagesSupported:true};}
  async sendImage(_target:string,_path:string,size:number,md5:string){this.calls++;assert.equal(size,bytes.length);assert.equal(md5,createHash('md5').update(bytes).digest('hex'));imageCalled();return {attempted:true,nativeReturned:true};}
 }
 const bridge=new ImageBridge(),adapter=new NativeMemoAdapter('memo',bridge,inbox,30,[],true,'备忘录',false,true);
 try{await adapter.connect();assert.equal(adapter.supportsGeneratedImages,true);const sending=adapter.sendImage('memo',path);await called;
 const md5=createHash('md5').update(bytes).digest('hex');inbox.emit('[图片]',{conversationId:'other',image:{md5}});inbox.emit('[图片]',{id:'0',image:{md5}});inbox.emit('[图片]',{image:{md5:'00000000000000000000000000000000'}});assert.equal((await adapter.sendText('memo','busy')).status,'not-sent');
 inbox.emit('[图片]',{id:'12345',image:{md5}});assert.deepEqual(await sending,{status:'sent',messageId:'12345',reason:'native send confirmed in local WeChat database'});assert.equal(bridge.calls,1);
 assert.equal((await adapter.sendImage('memo',resolve('.env'))).status,'not-sent');assert.equal(bridge.calls,1);
 }finally{await adapter.disconnect();await rm(directory,{recursive:true,force:true});}
});
