import 'dotenv/config';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {createApplication} from '../dist/core/application.js';
import {environmentSchema} from '../dist/config/environment.js';
import {NativeMemoBridge} from '../dist/adapters/wechat/native/bridge.js';
import {NativeMemoAdapter} from '../dist/adapters/wechat/native/memo-adapter.js';
import {DatabaseObserver} from '../dist/adapters/wechat/database/observer.js';
import {reserveNativeEndpoint} from '../dist/adapters/wechat/native/endpoint-reservation.js';
import {Store} from '../dist/storage/store.js';
import {SettingsRepository} from '../dist/config/settings.js';

const friendMode=process.argv.includes('--live-friend-test');
const groupMode=process.argv.includes('--include-test-group');
const railwayMode=process.argv.includes('--railway-test-group');
if(railwayMode&&!groupMode)throw Error('--railway-test-group requires --include-test-group');
if(groupMode&&!friendMode)throw Error('--include-test-group requires --live-friend-test');
if(!friendMode&&!process.argv.includes('--live-filehelper-test'))throw Error('Requires explicit --live-filehelper-test or --live-friend-test');
const target=friendMode?process.env.FISHBOT_TEST_FRIEND_ID:'filehelper',targetName=friendMode?(process.env.FISHBOT_TEST_FRIEND_NAME??'测试好友'):'文件传输助手';
const extra=groupMode?[{id:railwayMode?process.env.FISHBOT_TEST_GROUP_2_ID:process.env.FISHBOT_TEST_GROUP_ID,kind:'group',name:'测试群',selfTest:false}]:[];
if(!target||extra.some(t=>!t.id))throw Error('Configure authorized test friend/group IDs before running');
const scopes=[['private',target],...extra.map(t=>[t.kind,t.id])];
const port=8766,reservation=await reserveNativeEndpoint(port);
const python='C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe';
const root='C:/wx/tools/fishbot-frida-research-17.25.0';
const profileName=railwayMode?'cloud-railway-profile.json':friendMode?'cloud-friend-profile.json':'cloud-profile.json';
if(railwayMode){
 const profile=JSON.parse((await readFile(`${root}/cloud-friend-profile.json`,'utf8')).replace(/^\uFEFF/,''));
 profile.agent.targets=[target,...extra.map(t=>t.id)].map(id=>({id,bytes:[...Buffer.from(id,'utf8')]}));
 await writeFile(`${root}/${profileName}`,JSON.stringify(profile));
}
const env=environmentSchema.parse({...process.env,PORT:port,ADAPTER:'mock',DRY_RUN:'false',DB_PATH:resolve(`data/cloud-${groupMode?'group':friendMode?'friend':'filehelper'}-${Date.now()}.sqlite`),TEST_SCOPES:JSON.stringify(scopes)});
const preparation=new Store(env.DB_PATH);
try{const settings=new SettingsRepository(preparation);settings.save({...settings.get(),allConversations:false,privateEnabled:true,groupEnabled:groupMode,paused:false,whitelist:scopes,memoryEnabled:false,expressionsEnabled:false});}finally{preparation.close();}
const inbox=new DatabaseObserver(undefined,2000,{storagePath:env.WECHAT_STORAGE_PATH,keyPath:env.WECHAT_DB_KEY_FILE});
const bridge=new NativeMemoBridge(python,()=>spawn(python,['-X','utf8',`${root}/probe-cloud-native.py`,'--root',root,'--dependencies',root,'--profile',profileName,'--json-host',...(process.argv.includes('--windowless')?['--windowless']:[])],{cwd:process.cwd(),windowsHide:true,stdio:'pipe'}));
const adapter=new NativeMemoAdapter(target,bridge,inbox,15000,extra,!friendMode,targetName);
let runtime;
try{
 runtime=await createApplication(env,undefined,adapter);
 await new Promise(r=>reservation.close(r));
 await runtime.app.listen({host:'127.0.0.1',port});
 const stop=()=>runtime.app.close().finally(()=>{if(process.connected)process.disconnect();});
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void stop();});
 process.on('message',m=>{if(m?.type==='shutdown')void stop();});
 console.log(JSON.stringify({port,scope:groupMode?`authorized test friend and ${extra[0].name} group`:friendMode?'authorized test friend only':'filehelper only',selfTestPrefix:friendMode?null:'鱼测试：',database:env.DB_PATH,liveSend:true,clientRestartSupported:false}));
}catch(error){if(runtime)await runtime.app.close();else{await bridge.stop();await inbox.close();}if(reservation.listening)await new Promise(r=>reservation.close(r));throw error;}
