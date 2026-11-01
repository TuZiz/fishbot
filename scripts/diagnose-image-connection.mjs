// Read-only authenticated model discovery; no paid image request or secret output.
import 'dotenv/config';
import {mkdir,writeFile} from 'node:fs/promises';
const {lookup}=await import('node:dns/promises');
const dns=await Promise.all(['api.zyuou.com','tp.xtokenmirror.com'].map(async host=>({host,addresses:await lookup(host,{all:true}).catch(e=>({error:e.code}))})));
const start=Date.now(),reports=[];
for(const [name,url,key] of [['primary',process.env.IMAGE_BASE_URL,process.env.IMAGE_API_KEY],['backup',process.env.IMAGE_BACKUP_URL,process.env.IMAGE_BACKUP_KEY]]){
 try{const response=await fetch(url+'/models',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});const data=await response.json();reports.push({name,status:response.status,elapsedMs:Date.now()-start,imageModels:data.data?.map(m=>m.id).filter(id=>id.includes('image'))});}
 catch(error){reports.push({name,error:error.name,code:error.cause?.code,elapsedMs:Date.now()-start});}
}
const usage=await fetch('http://127.0.0.1:8765/api/status',{headers:{'x-fishbot-token':process.env.INGEST_TOKEN}}).then(r=>r.ok?r.json():null);
const report={dns,models:reports,recentErrors:usage?.errors?.map(e=>({at:e.created,error:e.message})).slice(0,5)};
await mkdir('data/research/images',{recursive:true});await writeFile('data/research/images/cloud-image-connection.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
