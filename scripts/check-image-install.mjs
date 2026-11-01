import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
const modules=[];
for(const name of ['fastify','fast-xml-parser','zod','dotenv']){try{await import(name);modules.push({name,ready:true});}catch(error){modules.push({name,ready:false,code:error.code});}}
const folder=join(homedir(),'AppData/Local/npm-cache/_logs');let npmCodes=[];
try{const files=(await readdir(folder)).filter(f=>f.endsWith('.log')).sort();const body=await readFile(join(folder,files.at(-1)),'utf8');npmCodes=[...new Set(body.match(/ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ECONNABORTED|EINTEGRITY/g)??[])];}catch{}
let verifiedFiles=0;
if(process.argv.includes('--verify-bundle')){
 const manifest=JSON.parse(await readFile('image-dependencies-manifest.json','utf8'));
 for(const file of manifest.files){if(!file.path.startsWith('node_modules/')||file.path.includes('..'))throw Error('Invalid dependency manifest path');const bytes=await readFile(file.path);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Dependency hash mismatch');verifiedFiles++;}
}
const registry=process.argv.includes('--offline')?{skipped:true}:await fetch('https://registry.npmjs.org/fast-xml-parser',{signal:AbortSignal.timeout(10000)}).then(r=>({ok:r.ok,status:r.status}),error=>({ok:false,error:error.name}));
console.log(JSON.stringify({modules,npmCodes,registry,verifiedFiles}));
if(modules.some(m=>!m.ready))process.exitCode=1;
