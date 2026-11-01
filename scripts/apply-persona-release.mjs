// Updates only the saved role card through the existing authenticated hot-update API.
import 'dotenv/config';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=resolve('C:/wx/fishbot');if(resolve(process.cwd()).toLowerCase()!==root.toLowerCase())throw Error('Wrong workspace');
const stage=resolve('data/deploy/persona-release');
const manifest=JSON.parse(await readFile(join(stage,'manifest.json'),'utf8'));
const mapping={'persona.js':'dist/config/persona.js','settings.js':'dist/config/settings.js','participation.js':'dist/group/participation.js','index.html':'dist/admin/index.html'};
if(manifest.length!==4||new Set(manifest.map(e=>e.file)).size!==4)throw Error('Invalid persona release');
for(const item of manifest){if(!Object.hasOwn(mapping,item.file)||createHash('sha256').update(await readFile(join(stage,item.file))).digest('hex')!==item.sha256)throw Error('Persona release validation failed');}
const {DEFAULT_PERSONA}=await import(pathToFileURL(join(stage,'persona.js')).href);
const headers={'x-fishbot-token':process.env.INGEST_TOKEN,'Content-Type':'application/json'};
const request=async(method,path,body)=>{const r=await fetch('http://127.0.0.1:8765'+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Persona settings API rejected');return r.json();};
const current=await request('GET','/api/settings');
const backup=resolve('data/deploy/persona-before-'+Date.now());await mkdir(backup);
await writeFile(join(backup,'previous-persona.json'),JSON.stringify({persona:current.persona},null,2));
for(const [source,target] of Object.entries(mapping)){
 try{await copyFile(target,join(backup,source));}catch(error){if(error.code!=='ENOENT')throw error;}
 await copyFile(join(stage,source),target);
}
const result=await request('PUT','/api/settings',{...current,persona:DEFAULT_PERSONA});
const latest=await request('GET','/api/settings');
const withoutPersona=value=>{const {persona,...rest}=value;return JSON.stringify(rest);};
if(result.persona!==DEFAULT_PERSONA||latest.persona!==DEFAULT_PERSONA||withoutPersona(current)!==withoutPersona(latest))throw Error('Persona round-trip or preserved settings mismatch');
console.log(JSON.stringify({hotUpdated:true,verified:true,personaLength:latest.persona.length,otherSettingsPreserved:true,restartRequired:false,backup}));
