// Independent synthetic integration probe. Never logs keys, prompts or image bytes.
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename, join } from 'node:path';
import { ImageClient } from '../dist/images/client.js';
import { environmentSchema } from '../dist/config/environment.js';

const {values}=parseArgs({options:{backup:{type:'boolean'},reference:{type:'string'},'timeout-ms':{type:'string'}}});
const env=environmentSchema.parse(process.env),backup=values.backup===true;
const provider=backup?{url:env.IMAGE_BACKUP_URL,key:env.IMAGE_BACKUP_KEY,model:env.IMAGE_BACKUP_MODEL}:{url:env.IMAGE_BASE_URL,key:env.IMAGE_API_KEY,model:env.IMAGE_MODEL};
if(!provider.key)throw Error('Selected image provider is not configured');
const timeout=Number(values['timeout-ms']??env.IMAGE_TIMEOUT_MS);
if(!Number.isInteger(timeout)||timeout<1000||timeout>600000)throw Error('Timeout must be 1000..600000 ms');
let reference;
if(values.reference){
 const bytes=await readFile(resolve(values.reference));
 const mime=bytes[0]===137?'image/png':bytes[0]===255?'image/jpeg':bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 if(!mime||bytes.length>20*1024*1024)throw Error('Reference must be PNG/JPEG/WebP under 20 MiB');
 reference={bytes,mime};
}
const output='data/research/images',started=Date.now();
const evidence={date:new Date().toISOString(),provider:new URL(provider.url).host,model:provider.model,operation:reference?'edit':'generate',ok:false};
try{
 const client=new ImageClient([provider],output,fetch,{timeoutMs:timeout,downloadOrigins:env.IMAGE_DOWNLOAD_ORIGINS});
 const path=await client.generate({prompt:reference?'Change the ceramic cup to emerald green. Preserve its shape, handle, white background, lighting and framing. No text.':'A blue ceramic teacup on a white table, minimal studio photograph, no text.',reference},new AbortController().signal);
 Object.assign(evidence,{ok:true,elapsedMs:Date.now()-started,file:basename(path)});
}catch(error){
 const message=error instanceof Error?error.message:'';
 Object.assign(evidence,{elapsedMs:Date.now()-started,error:/^(Image HTTP \d{3}|Image response has no image|Image download origin is not trusted)$/.test(message)?message:error instanceof Error?error.name:'Error'});
 process.exitCode=1;
}
await mkdir(output,{recursive:true});await writeFile(join(output,`probe-${backup?'backup':'primary'}-${evidence.operation}.json`),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
