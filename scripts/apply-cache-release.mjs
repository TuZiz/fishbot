// Exact manifest update; requires an idle, stopped instance and owned maintenance marker.
import {readFile,writeFile,copyFile,mkdir,access} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createConnection} from 'node:net';
const root=resolve('C:/wx/fishbot'),nativeRoot=resolve('C:/wx/tools/fishbot-frida-research-17.25.0');
if(resolve(process.cwd()).toLowerCase()!==root.toLowerCase())throw Error('Wrong deployment workspace');
const stage=resolve(root,'data/deploy/cached-photo-release');
const permitted=new Set(['dist/core/application.js','dist/images/references.js','dist/images/conversation.js','dist/images/cached-format.js','dist/adapters/wechat/native/bridge.js','dist/adapters/wechat/native/recovering-bridge.js','dist/adapters/wechat/database/image-cache.js','dist/adapters/wechat/database/image-reference-worker.js','dist/adapters/wechat/database/cached-image-references.js','scripts/run-cloud-all.mjs','runtime-native/cached-image-reader.js','runtime-native/probe-cloud-native.py']);
const manifest=JSON.parse(await readFile(join(stage,'manifest.json'),'utf8'));
const converter=await readFile('C:/wx/tools/imageio-ffmpeg-0.6.0/ffmpeg-win-x86_64-v7.1.exe');
if(!/^[a-f0-9]{64}$/.test(manifest.ffmpegSha256)||createHash('sha256').update(converter).digest('hex')!==manifest.ffmpegSha256)throw Error('Converter hash mismatch');
if(manifest.files.length!==permitted.size||new Set(manifest.files.map(v=>v.path)).size!==permitted.size)throw Error('Unexpected manifest');
const files=[];
for(const entry of manifest.files){
 if(!permitted.has(entry.path))throw Error('Unexpected release path');
 const source=resolve(stage,entry.path),bytes=await readFile(source);
 if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Release hash mismatch');
 const native=entry.path.startsWith('runtime-native/'),base=native?nativeRoot:root,target=resolve(base,native?entry.path.slice(15):entry.path),rel=relative(base,target);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Unsafe release target');
 files.push({source,target,path:entry.path});
}
if(process.argv.includes('--verify-only')){console.log(JSON.stringify({verified:true,count:files.length,changedRuntime:false}));process.exit(0);}
for(const port of [8765,8766]){
 const busy=await new Promise(result=>{const socket=createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();result(true);});socket.once('error',()=>result(false));});
 if(busy)throw Error('Instance is still listening');
}
if((await readFile('data/STOP','utf8')).trim()!=='image-maintenance')throw Error('Maintenance marker is not owned');
const backup=join(root,'data/deploy/backup-cache-'+Date.now());await mkdir(backup,{recursive:true});
for(const file of files){
 if(await access(file.target).then(()=>true,()=>false)){const saved=join(backup,file.path);await mkdir(dirname(saved),{recursive:true});await copyFile(file.target,saved);}
 await mkdir(dirname(file.target),{recursive:true});await copyFile(file.source,file.target);
}
await writeFile(join(backup,'release.json'),JSON.stringify({at:new Date().toISOString(),files:manifest.files},null,2));
console.log(JSON.stringify({applied:true,count:files.length,backup,envUnchanged:true,stopRetained:true}));
