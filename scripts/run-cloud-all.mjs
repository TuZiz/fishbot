import 'dotenv/config';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApplication} from '../dist/core/application.js';
import {environmentSchema} from '../dist/config/environment.js';
import {NativeMemoBridge} from '../dist/adapters/wechat/native/bridge.js';
import {RecoveringNativeBridge} from '../dist/adapters/wechat/native/recovering-bridge.js';
import {NativeMemoAdapter} from '../dist/adapters/wechat/native/memo-adapter.js';
import {DatabaseObserver} from '../dist/adapters/wechat/database/observer.js';
import {reserveNativeEndpoint} from '../dist/adapters/wechat/native/endpoint-reservation.js';
import {Store} from '../dist/storage/store.js';
import {SettingsRepository} from '../dist/config/settings.js';
import {CachedImageReferences} from '../dist/adapters/wechat/database/cached-image-references.js';

// Uses the fingerprint-bound cloud research runtime; never assumes an unopened chat can send.
const port=Number(process.env.CLOUD_NATIVE_PORT??8766),reservation=await reserveNativeEndpoint(port);
const root='C:/wx/tools/fishbot-frida-research-17.25.0';
const python='C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe';
const env=environmentSchema.parse({...process.env,PORT:port,ADAPTER:'mock',DRY_RUN:process.env.DRY_RUN??'true',DB_PATH:resolve(process.env.NATIVE_DB_PATH??`data/cloud-all-${Date.now()}.sqlite`),TEST_SCOPES:'[]'});
const inbox=new DatabaseObserver(undefined,2000,{storagePath:env.WECHAT_STORAGE_PATH,keyPath:env.WECHAT_DB_KEY_FILE});
let runtime,bridge,references;
try{
 inbox.start();const until=Date.now()+30000;
 while(!inbox.sessions.length&&Date.now()<until){if(inbox.status.error)throw Error(inbox.status.error);await new Promise(r=>setTimeout(r,100));}
 const catalog=inbox.sessions.map(s=>({...s,selfTest:false}));
 if(!catalog.length||catalog.length>500)throw Error('Conversation catalog unavailable or exceeds 500 entries');
 const first=catalog.find(s=>s.id==='filehelper'&&s.kind==='private')??catalog.find(s=>s.kind==='private');
 if(!first)throw Error('No private conversation in catalog');
 const profile=JSON.parse((await readFile(`${root}/cloud-profile.json`,'utf8')).replace(/^\uFEFF/,''));
 profile.agent.targets=catalog.map(s=>({id:s.id,bytes:[...Buffer.from(s.id,'utf8')]}));
 await writeFile(`${root}/cloud-all-profile.json`,JSON.stringify(profile));
 const preparation=new Store(env.DB_PATH);
 try{const settings=new SettingsRepository(preparation);settings.save({...settings.get(),allConversations:true,whitelist:[],privateEnabled:true,groupEnabled:true,paused:false,expressionsEnabled:false});}finally{preparation.close();}
 bridge=new RecoveringNativeBridge(new NativeMemoBridge(python,()=>spawn(python,['-X','utf8',`${root}/probe-cloud-native.py`,'--root',root,'--dependencies',root,'--profile','cloud-all-profile.json','--json-host',...(process.env.WECHAT_NATIVE_IMAGES==='true'?['--enable-verified-images']:[]),...(process.env.FISHBOT_WINDOWLESS==='true'?['--windowless']:[])],{cwd:process.cwd(),windowsHide:true,stdio:'pipe'})));
 const adapter=new NativeMemoAdapter(first.id,bridge,inbox,11000,catalog.filter(s=>s.id!==first.id),false,first.name,true,process.env.WECHAT_NATIVE_IMAGES==='true');
 references=new CachedImageReferences(bridge,{storagePath:env.WECHAT_STORAGE_PATH,keyPath:env.WECHAT_DB_KEY_FILE},'C:/wx/tools/imageio-ffmpeg-0.6.0/ffmpeg-win-x86_64-v7.1.exe');
 runtime=await createApplication(env,undefined,adapter,references);
 runtime.activity.setNames(catalog.map(s=>[s.id,s.name]));
 runtime.app.addHook('onClose',async()=>{await references.close();});
 const stop=()=>runtime.app.close().finally(()=>{if(process.connected)process.disconnect();});
 runtime.app.post('/api/native/shutdown',async()=>{setImmediate(()=>{void stop();});return {stopping:true};});
 await new Promise(r=>reservation.close(r));await runtime.app.listen({host:'127.0.0.1',port});
 const status=await adapter.getStatus();
 const nativeStatus=await bridge.status();
 console.log(`[FishBot] 引用照片自动下载：${nativeStatus.quotedDownloadsSupported?'已启用（仅引用改图，单任务）':'未启用'}；缓存/下载失败不调用改图 API`);
 console.log(`[FishBot] 服务就绪 | 端口 ${port} | 会话 ${catalog.length} | 全量无白名单 | ${env.DRY_RUN==='true'?'模拟发送':'真实发送'} | 后端 ${status.backend} | ${status.requiresChatWindow?'需要聊天窗口':'无需对应聊天窗口'} | 图片 ${adapter.supportsGeneratedImages?'已启用':'未启用'}`);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop();});
 process.on('message',m=>{if(m?.type==='shutdown')void stop();});
 console.log(JSON.stringify({port,allConversations:true,whitelistCount:0,catalogCount:catalog.length,database:env.DB_PATH,liveSend:env.DRY_RUN==='false',newConversationsRequireRestart:true,clientRestartSupported:false,requiresChatWindow:status.requiresChatWindow}));
}catch(error){if(runtime)await runtime.app.close();else{await references?.close();await bridge?.stop();await inbox.close();}if(reservation.listening)await new Promise(r=>reservation.close(r));throw error;}
