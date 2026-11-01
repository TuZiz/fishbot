// Bounded, synthetic queue-to-real-WeChat probe. This does not claim a real peer's inbound message.
import 'dotenv/config';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {environmentSchema} from '../dist/config/environment.js';
import {createApplication} from '../dist/core/application.js';
import {NativeMemoAdapter} from '../dist/adapters/wechat/native/memo-adapter.js';
import {NativeMemoBridge} from '../dist/adapters/wechat/native/bridge.js';
import {RecoveringNativeBridge} from '../dist/adapters/wechat/native/recovering-bridge.js';
import {DatabaseObserver} from '../dist/adapters/wechat/database/observer.js';
import {incomingSchema} from '../dist/schema.js';
const env=environmentSchema.parse({...process.env,ADAPTER:'mock',DB_PATH:':memory:',DRY_RUN:'false',TEST_SCOPES:'[["private","filehelper"]]'});
const root='C:/wx/tools/fishbot-frida-research-17.25.0',python='C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe';
const bridge=new RecoveringNativeBridge(new NativeMemoBridge(python,()=>spawn(python,['-X','utf8',`${root}/probe-cloud-native.py`,'--root',root,'--dependencies',root,'--profile','cloud-profile.json','--json-host','--windowless','--enable-verified-images'],{windowsHide:true,stdio:'pipe'})));
const inbox=new DatabaseObserver(undefined,2000,{storagePath:env.WECHAT_STORAGE_PATH,keyPath:env.WECHAT_DB_KEY_FILE});
const adapter=new NativeMemoAdapter('filehelper',bridge,inbox,11000,[],false,'filehelper',true,true);
let runtime;
try{
 runtime=await createApplication(env,{async complete(){throw Error('Text AI is outside this synthetic image delivery probe');}},adapter);
 if(!runtime.engine.canSendImages)throw Error('Image capability handshake missing');
 const message=incomingSchema.parse({id:'image-queue-probe-'+Date.now(),conversationId:'filehelper',kind:'private',senderId:'synthetic-probe',text:'synthetic image queue probe',timestamp:Date.now()});
 runtime.store.enqueue(message,resolve(process.argv[2]),'image');await runtime.delivery.flush();
 const row=runtime.store.db.prepare('SELECT status,result,attempts FROM outbox ORDER BY id DESC LIMIT 1').get();
 const report={syntheticInbound:true,realWechatTransport:true,queueStatus:row.status,attempts:row.attempts,result:JSON.parse(row.result),imagesSupported:adapter.supportsGeneratedImages,observer:{error:inbox.status.error,skipped:inbox.status.skipped,imageEvents:inbox.events.filter(m=>m.image).map(m=>({id:m.id,isSelf:m.isSelf}))}};
 await mkdir('data/research/images',{recursive:true});await writeFile('data/research/images/unified-image-delivery.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(row.status!=='sent')process.exitCode=1;
}finally{if(runtime)await runtime.app.close();else{await bridge.stop();await inbox.close();}}
