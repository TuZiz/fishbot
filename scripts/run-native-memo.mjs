import 'dotenv/config';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,basename,dirname} from 'node:path';
import {createApplication} from '../dist/core/application.js';
import {environmentSchema} from '../dist/config/environment.js';
import {NativeMemoBridge} from '../dist/adapters/wechat/native/bridge.js';
import {RecoveringNativeBridge} from '../dist/adapters/wechat/native/recovering-bridge.js';
import {NativeMemoAdapter} from '../dist/adapters/wechat/native/memo-adapter.js';
import {DatabaseObserver} from '../dist/adapters/wechat/database/observer.js';
import {Store} from '../dist/storage/store.js';
import {SettingsRepository} from '../dist/config/settings.js';
import {reserveNativeEndpoint} from '../dist/adapters/wechat/native/endpoint-reservation.js';

// Reserve the local endpoint before touching scope files or opening a second Hook.
const port=Number(process.env.MEMO_TEST_PORT??8766);
const reservation=await reserveNativeEndpoint(port);
let inbox,runtime;
try{await main();}catch(error){
  if(runtime)await runtime.app.close();else if(inbox)await inbox.close();
  throw error;
}finally{if(reservation.listening)await new Promise(resolveClose=>reservation.close(resolveClose));}

async function main(){
if(!process.argv.includes('--enable-native-memo-test'))throw Error('Requires --enable-native-memo-test; this is not a general WeChat adapter');
const python=process.env.FISHBOT_PYTHON??process.argv.find(v=>v.startsWith('--python='))?.slice('--python='.length);
if(!python)throw Error('Set FISHBOT_PYTHON to the Python executable with the workspace Frida dependencies');
const {conversationId}=JSON.parse(await readFile('data/research/native/test-target.json','utf8'));
inbox=new DatabaseObserver();const extra=[];
if(process.argv.includes('--include-test-group')){
  inbox.start();
  const until=Date.now()+30000;
  while(!inbox.sessions.length&&Date.now()<until){if(inbox.status.error)break;await new Promise(r=>setTimeout(r,100));}
  const groups=inbox.sessions.filter(s=>s.kind==='group'&&s.name==='备忘录');
  if(groups.length!==1){await inbox.close();throw Error('Expected one explicitly authorized group named 备忘录');}
  extra.push({...groups[0],kind:'group',selfTest:false});
}
const storage=(await readFile('data/wechat/storage-path.txt','utf8')).trim(),account=basename(dirname(storage));
const privateSelfTestOnly=account===conversationId||account.startsWith(conversationId+'_');
const targets=[{id:conversationId,kind:'private',name:'备忘录',selfTest:privateSelfTestOnly},...extra];
await writeFile('data/wechat/native-targets.json',JSON.stringify(targets,null,2));
const env=environmentSchema.parse({...process.env,PORT:process.env.MEMO_TEST_PORT??'8766',DB_PATH:resolve('data/native-memo-test.sqlite'),DRY_RUN:process.argv.includes('--live-send')?'false':'true',TEST_SCOPES:JSON.stringify([['private',conversationId]])});
// This dedicated experiment must never replay a prior run's queued sends or inputs.
const preparation=new Store(env.DB_PATH);
try{
  const settings=new SettingsRepository(preparation);
  settings.save({...settings.get(),paused:false,privateEnabled:true,groupEnabled:extra.length>0,whitelist:targets.map(t=>[t.kind,t.id]),memoryEnabled:false,expressionsEnabled:false});
  preparation.db.prepare("UPDATE outbox SET status='cancelled',result=? WHERE status='pending'").run(JSON.stringify({reason:'experimental runner restarted; old work is not replayed'}));
  preparation.db.exec('CREATE TABLE IF NOT EXISTS handled(scope TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(scope,id)); INSERT OR IGNORE INTO handled SELECT scope,id FROM messages');
}finally{preparation.close();}
const bridge=new RecoveringNativeBridge(new NativeMemoBridge(python));
const adapter=new NativeMemoAdapter(conversationId,bridge,inbox,11000,extra,privateSelfTestOnly);
runtime=await createApplication(env,undefined,adapter);
runtime.app.post('/api/native/reconnect',async()=>{await bridge.stop();await bridge.start();return bridge.status();});
await new Promise(resolveClose=>reservation.close(resolveClose));
try{await runtime.app.listen({host:'127.0.0.1',port:env.PORT});}catch(error){await runtime.app.close();throw error;}
let closing;
const shutdown=()=>{closing??=runtime.app.close().finally(()=>{if(process.connected)process.disconnect();});void closing;};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,shutdown);
process.on('message',message=>{if(message?.type==='shutdown')shutdown();});
console.log(JSON.stringify({backend:'native-memo-experimental',dryRun:env.DRY_RUN==='true',port:env.PORT,warmupRequired:false,test:'在备忘录发送 鱼测试：你的问题',friendIncomingEnabled:!privateSelfTestOnly,groupTestEnabled:extra.length>0,imagesSupported:false,groupEndToEndVerified:false}));
}
