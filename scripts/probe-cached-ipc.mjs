// Maintenance-only production IPC/lookup/normalization smoke. No send, API call or HTTP listener.
import 'dotenv/config';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {NativeMemoBridge} from '../../dist/adapters/wechat/native/bridge.js';
import {RecoveringNativeBridge} from '../../dist/adapters/wechat/native/recovering-bridge.js';
import {CachedImageReferences} from '../../dist/adapters/wechat/database/cached-image-references.js';
if((await readFile('data/STOP','utf8')).trim()!=='image-maintenance')throw Error('Requires owned maintenance');
const db=new DatabaseSync(process.env.NATIVE_DB_PATH,{readOnly:true});let message;
try{
 const row=db.prepare("SELECT body FROM messages WHERE json_type(body,'$.image')='object' AND json_extract(body,'$.isSelf')=0 AND json_extract(body,'$.kind')='private' ORDER BY CAST(json_extract(body,'$.timestamp') AS INTEGER) DESC LIMIT 1").get();
 if(!row)throw Error('No authorized photo fixture');const photo=JSON.parse(row.body);
 if(Date.now()-photo.timestamp>1800000)throw Error('Photo fixture no longer recent');
 message={...photo,id:'reference-smoke',image:undefined,text:'reference smoke',quote:{type:3,messageId:photo.id,senderId:photo.senderId,image:photo.image}};
}finally{db.close();}
const root='C:/wx/tools/fishbot-frida-research-17.25.0',python='C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe';
const bridge=new RecoveringNativeBridge(new NativeMemoBridge(python,()=>spawn(python,['-X','utf8',root+'/probe-cloud-native.py','--root',root,'--dependencies',root,'--profile','cloud-all-profile.json','--json-host','--enable-verified-images','--windowless'],{windowsHide:true,stdio:'pipe'})));
const references=new CachedImageReferences(bridge,{storagePath:process.env.WECHAT_STORAGE_PATH,keyPath:process.env.WECHAT_DB_KEY_FILE},'C:/wx/tools/imageio-ffmpeg-0.6.0/ffmpeg-win-x86_64-v7.1.exe');
try{
 await bridge.start();if(!(await bridge.status()).ready)throw Error('Native smoke handshake failed');
 const image=await references.resolve(message,AbortSignal.timeout(30000));if(!image)throw Error('Production original reference unavailable');
 const report={at:new Date().toISOString(),productionIPC:true,conversationIdentityChecked:true,originalMD5Checked:true,mime:image.mime,bytes:image.bytes.length,convertedWidth:image.bytes.readUInt32BE(16),convertedHeight:image.bytes.readUInt32BE(20),paidRequests:0,sends:0};
 await writeFile('data/research/images/received-photo-ipc.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await references.close();await bridge.stop();}
