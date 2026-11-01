// Apply an exact staged release, preserve configuration and let the existing
// supervisor restart its one child after graceful native-host shutdown.
import 'dotenv/config';
import {readFile,writeFile,copyFile,mkdir,access,rm} from 'node:fs/promises';
import {resolve,relative,isAbsolute,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve('C:/wx/fishbot'),nativeRoot=resolve('C:/wx/tools/fishbot-frida-research-17.25.0');
if(resolve(process.cwd()).toLowerCase()!==root.toLowerCase())throw Error('Incorrect deployment directory');
const stage=join(root,'data/deploy/quoted-download-release');
const paths=[
 'dist/adapters/wechat/database/media-message.js','dist/adapters/wechat/database/messages.js',
 'dist/adapters/wechat/database/image-reference-worker.js','dist/adapters/wechat/database/cached-image-references.js',
 'dist/adapters/wechat/database/quoted-image-downloads.js','dist/adapters/wechat/native/bridge.js',
 'dist/adapters/wechat/native/recovering-bridge.js','dist/images/conversation.js','scripts/run-cloud-all.mjs',
 'runtime-native/probe-cloud-native.py','runtime-native/quoted-image-task.js',
 'runtime-native/quoted-image-download.js','runtime-native/quoted-image-download-fingerprints.json'
];
const manifest=JSON.parse(await readFile(join(stage,'manifest.json'),'utf8'));
if(manifest.files.length!==paths.length||new Set(manifest.files.map(v=>v.path)).size!==paths.length)throw Error('Unexpected release manifest');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[];
for(const entry of manifest.files){
 if(!paths.includes(entry.path))throw Error('Unexpected release path');
 const source=join(stage,entry.path),bytes=await readFile(source);
 if(hash(bytes)!==entry.sha256)throw Error('Release hash mismatch');
 const base=entry.path.startsWith('runtime-native/')?nativeRoot:root;
 const target=resolve(base,entry.path.startsWith('runtime-native/')?entry.path.slice(15):entry.path),rel=relative(base,target);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Unsafe release path');
 files.push({...entry,source,target});
}
if(process.argv.includes('--verify-only')){console.log(JSON.stringify({verified:true,files:files.length}));process.exit(0);}
if(await access('data/STOP').then(()=>true,()=>false))throw Error('Existing STOP marker must be handled by its owner');
const headers={'x-fishbot-token':process.env.INGEST_TOKEN,'content-type':'application/json'};
const call=async(path,body)=>{const r=await fetch('http://127.0.0.1:8765'+path,{headers,method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('Deployment control request failed');return r.json();};
const health=await call('/health');
if(!health.ok||health.paused||!health.adapter.connected)throw Error('Deployment requires the healthy unpaused original instance');
const originalSettings=hash(Buffer.from(JSON.stringify(await call('/api/settings'))));
const protectedPaths=[join(root,'.env'),join(nativeRoot,'windowless-agent.js'),join(nativeRoot,'cached-image-reader.js')];
const protectedHashes=await Promise.all(protectedPaths.map(async p=>hash(await readFile(p))));
await call('/control',{paused:true});
let applied=false,shutdownRequested=false,phase='waiting-for-idle';
const changed=[];
const backup=join(root,'data/deploy/backup-quoted-download-'+Date.now());
try{
 const deadline=Date.now()+15000;
 while(true){
  const state=await call('/api/status'),h=await call('/health');
  if(!state.outbox.some(v=>v.status==='sending'&&v.count>0)&&!h.adapter.context?.busy)break;
  if(Date.now()>deadline)throw Error('Native sender did not become idle');
  await delay(250);
 }
 await mkdir(backup,{recursive:true});
 phase='backing-up';
 for(const file of files){
  file.existed=await access(file.target).then(()=>true,()=>false);
  if(file.existed){const old=join(backup,file.path);await mkdir(dirname(old),{recursive:true});await copyFile(file.target,old);file.previousHash=hash(await readFile(old));}
 }
 await writeFile(join(backup,'manifest.json'),JSON.stringify({files:files.map(({path,sha256,existed,previousHash})=>({path,sha256,existed,previousHash}))},null,2));
 phase='copying-release';
 for(const file of files){
  changed.push(file);
  await mkdir(dirname(file.target),{recursive:true});await copyFile(file.source,file.target);
  if(hash(await readFile(file.target))!==file.sha256)throw Error('Applied file hash mismatch');
 }
 applied=true;
 shutdownRequested=true;
 phase='restarting-original-child';
 // Fastify may close the response socket during its own graceful shutdown.
 // An acknowledgement alone is not evidence; require a new healthy child below.
 await call('/api/native/shutdown',{}).catch(()=>{});
 let ready=false;
 for(let attempt=0;attempt<120;attempt++){
  await delay(500);
  try{const h=await call('/health');if(h.ok&&h.adapter.connected&&h.adapter.context?.quotedDownloadsSupported&&h.uptime<health.uptime){ready=true;break;}}catch{}
 }
 if(!ready)throw Error('Original supervisor did not restore the updated native runtime');
 phase='verifying-runtime-and-configuration';
 const finalHealth=await call('/health');
 if(finalHealth.paused||finalHealth.dryRun!==health.dryRun||finalHealth.adapter.backend!==health.adapter.backend)throw Error('Runtime mode changed during deployment');
 if(originalSettings!==hash(Buffer.from(JSON.stringify(await call('/api/settings')))))throw Error('Runtime settings changed during deployment');
 for(let i=0;i<protectedPaths.length;i++)if(hash(await readFile(protectedPaths[i]))!==protectedHashes[i])throw Error('Protected configuration changed');
 const report={applied:true,files:files.length,hashesVerified:true,originalSupervisorRestarted:true,quotedDownloadsSupported:true,envAndPersonaPreserved:true,sends:0,paidRequests:0};
 await writeFile(join(backup,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
 let rollbackVerified=false;
 if(!shutdownRequested){
  try{
   for(const file of [...changed].reverse()){
    if(file.existed){await copyFile(join(backup,file.path),file.target);if(hash(await readFile(file.target))!==file.previousHash)throw Error('Rollback hash mismatch');}
    else await rm(file.target,{force:true});
   }
   rollbackVerified=true;
   await call('/control',{paused:false});
  }catch{ /* Preserve paused state and the exact backup when restoration is uncertain. */ }
 }else await call('/control',{paused:true}).catch(()=>{});
 await writeFile(join(root,'data/research/quoted-download-deploy-failed.json'),JSON.stringify({applied,phase,shutdownRequested,rollbackVerified,errorType:error?.name??'Error',backupExists:await access(backup).then(()=>true,()=>false)}));
 throw Error('Quoted download deployment incomplete; inspect the preserved deployment report');
}
