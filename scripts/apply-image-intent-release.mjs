// Exact one-file release through the existing supervisor; never replays input.
import 'dotenv/config';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
const root=resolve('C:/wx/fishbot');
const releaseName=process.argv.includes('--batch')?'image-intent-batch':'image-object-intent';
if(resolve(process.cwd()).toLowerCase()!==root.toLowerCase())throw Error('Incorrect deployment directory');
const hash=data=>createHash('sha256').update(data).digest('hex');
const source=join(root,'data/deploy/image-object-intent.js'),target=join(root,'dist/images/intent.js');
const manifest=JSON.parse(await readFile(join(root,'data/deploy/image-object-intent-manifest.json'),'utf8'));
if(hash(await readFile(source))!==manifest.sha256)throw Error('Staged intent checksum mismatch');
const {imageIntent}=await import(new URL('../data/deploy/image-object-intent.js',import.meta.url));
if(!imageIntent('@机器人 把这个图片改成脚踩地球',true)?.edit||imageIntent('把这个图片改成脚踩地球'))throw Error('Intent smoke check failed');
for(const text of ['把这个图片的猫变成红色 @机器人','给猫戴顶帽子','移除背景的路人','把图里的文字改成你好']){
 if(!imageIntent(text,true)?.edit)throw Error('Batch edit smoke check failed');
}
for(const text of ['不要把猫变红','你觉得把猫变红怎么样','识别图片里的文字']){
 if(imageIntent(text,true))throw Error('Discussion smoke check failed');
}
const call=async(path,body)=>{
 const response=await fetch('http://127.0.0.1:8765'+path,{method:body?'POST':'GET',headers:{'x-fishbot-token':process.env.INGEST_TOKEN,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(7000)});
 if(!response.ok)throw Error('Deployment control request failed');
 return response.json();
};
const health=await call('/health');
if(!health.ok||!health.adapter.connected||health.paused||!health.adapter.context?.quotedDownloadsSupported)throw Error('Expected healthy current native instance');
const settingsHash=hash(Buffer.from(JSON.stringify(await call('/api/settings'))));
const envHash=hash(await readFile('.env'));
const backup=join(root,'data/deploy/backup-'+releaseName+'-'+Date.now());
await mkdir(backup,{recursive:true});
await copyFile(target,join(backup,'intent.js'));
let phase='pausing',restarting=false,replaced=false;
try{
 await call('/control',{paused:true});
 const deadline=Date.now()+15000;
 while(true){
  const state=await call('/api/status'),h=await call('/health');
  if(!state.outbox.some(v=>v.status==='sending'&&v.count>0)&&!h.adapter.context?.busy)break;
  if(Date.now()>=deadline)throw Error('Sender still busy');
  await delay(250);
 }
 phase='copying';replaced=true;
 await copyFile(source,target);
 if(hash(await readFile(target))!==manifest.sha256)throw Error('Installed intent checksum mismatch');
 phase='restarting';restarting=true;
 await call('/api/native/shutdown',{}).catch(()=>{});
 let ready=false;
 for(let attempt=0;attempt<120;attempt++){
  await delay(500);
  try{const h=await call('/health');if(h.ok&&h.adapter.connected&&h.adapter.nativeReady&&h.adapter.context?.quotedDownloadsSupported&&!h.paused&&h.dryRun===health.dryRun&&h.uptime<health.uptime){ready=true;break;}}catch{}
 }
 if(!ready)throw Error('Updated child did not become ready');
 phase='verifying';
 if(hash(Buffer.from(JSON.stringify(await call('/api/settings'))))!==settingsHash||hash(await readFile('.env'))!==envHash)throw Error('Configuration preservation check failed');
 const result={applied:true,files:1,hashVerified:true,configurationPreserved:true,quotedDownloadsSupported:true,originalSupervisorRestarted:true,replayedInputs:0,testToolSends:0,testToolPaidRequests:0};
 await writeFile(join(backup,'result.json'),JSON.stringify(result,null,2));
 await writeFile('data/research/native/'+releaseName+'-deployment.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
}catch{
 let rolledBack=false;
 if(!restarting){
  try{if(replaced)await copyFile(join(backup,'intent.js'),target);rolledBack=true;await call('/control',{paused:false});}catch{}
 }else await call('/control',{paused:true}).catch(()=>{});
 await writeFile('data/research/native/'+releaseName+'-deploy-failed.json',JSON.stringify({phase,restarting,rolledBack}));
 throw Error('Intent release incomplete; inspect the preserved deployment report');
}
