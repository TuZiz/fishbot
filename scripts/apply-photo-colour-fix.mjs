import {readFile,copyFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createConnection} from 'node:net';
import {resolve,join} from 'node:path';
const root=resolve('C:/wx/fishbot');if(resolve(process.cwd()).toLowerCase()!==root.toLowerCase())throw Error('Wrong deployment root');
const entries=JSON.parse(await readFile('data/deploy/photo-colour-manifest.json','utf8'));
const allowed=new Set(['cached-format.js','wxgf.js','client.js']);
if(entries.length!==3||new Set(entries.map(v=>v.file)).size!==3)throw Error('Unexpected manifest');
for(const entry of entries){
 if(!allowed.has(entry.file))throw Error('Unexpected file');
 const bytes=await readFile('data/deploy/cached-photo-release/dist/images/'+entry.file);
 if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Hash mismatch');
}
if(process.argv.includes('--verify-only')){console.log(JSON.stringify({verified:true,files:3}));process.exit(0);}
if((await readFile('data/STOP','utf8')).trim()!=='image-maintenance')throw Error('Maintenance not owned');
for(const port of [8765,8766]){
 const busy=await new Promise(result=>{const socket=createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();result(true);});socket.once('error',()=>result(false));});
 if(busy)throw Error('Runtime still listening');
}
const backup=join(root,'data/deploy/backup-photo-colour-'+Date.now());await mkdir(backup);
for(const entry of entries){
 const target='dist/images/'+entry.file;
 try{await copyFile(target,join(backup,entry.file));}catch(e){if(e.code!=='ENOENT')throw e;}
 await copyFile('data/deploy/cached-photo-release/'+target,target);
}
await writeFile(join(backup,'manifest.json'),JSON.stringify(entries,null,2));console.log(JSON.stringify({applied:true,files:3,backup}));
