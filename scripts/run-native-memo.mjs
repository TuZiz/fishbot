import 'dotenv/config';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApplication} from '../dist/core/application.js';
import {environmentSchema} from '../dist/config/environment.js';
import {NativeMemoBridge} from '../dist/adapters/wechat/native/bridge.js';
import {NativeMemoAdapter} from '../dist/adapters/wechat/native/memo-adapter.js';
import {DatabaseObserver} from '../dist/adapters/wechat/database/observer.js';
import {Store} from '../dist/storage/store.js';
import {SettingsRepository} from '../dist/config/settings.js';
if(!process.argv.includes('--enable-native-memo-test'))throw Error('Requires --enable-native-memo-test; this is not a general WeChat adapter');
const python=process.env.FISHBOT_PYTHON??process.argv.find(v=>v.startsWith('--python='))?.slice('--python='.length);
if(!python)throw Error('Set FISHBOT_PYTHON to the Python executable with the workspace Frida dependencies');
const {conversationId}=JSON.parse(await readFile('data/research/native/test-target.json','utf8'));
const env=environmentSchema.parse({...process.env,PORT:process.env.MEMO_TEST_PORT??'8766',DB_PATH:resolve('data/native-memo-test.sqlite'),DRY_RUN:process.argv.includes('--live-send')?'false':'true',TEST_SCOPES:JSON.stringify([['private',conversationId]])});
// This dedicated experiment must never replay a prior run's queued sends or inputs.
const preparation=new Store(env.DB_PATH);
try{
  const settings=new SettingsRepository(preparation);
  settings.save({...settings.get(),paused:false,privateEnabled:true,groupEnabled:false,whitelist:[['private',conversationId]],memoryEnabled:false,expressionsEnabled:false});
  preparation.db.prepare("UPDATE outbox SET status='cancelled',result=? WHERE status='pending'").run(JSON.stringify({reason:'experimental runner restarted; old work is not replayed'}));
  preparation.db.exec('CREATE TABLE IF NOT EXISTS handled(scope TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(scope,id)); INSERT OR IGNORE INTO handled SELECT scope,id FROM messages');
}finally{preparation.close();}
const adapter=new NativeMemoAdapter(conversationId,new NativeMemoBridge(python),new DatabaseObserver());
const runtime=await createApplication(env,undefined,adapter);
try{await runtime.app.listen({host:'127.0.0.1',port:env.PORT});}catch(error){await runtime.app.close();throw error;}
const shutdown=()=>{void runtime.app.close().finally(()=>{if(process.connected)process.disconnect();});};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,shutdown);
process.on('message',message=>{if(message?.type==='shutdown')shutdown();});
console.log(JSON.stringify({backend:'native-memo-experimental',dryRun:env.DRY_RUN==='true',port:env.PORT,warmup:'在备忘录发送 FishBot_CONNECT_1031',test:'在备忘录发送 鱼测试：你的问题',leaseMinutes:5,imagesSupported:false,groupsVerified:false}));
