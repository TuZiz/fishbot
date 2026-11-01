// Applies a verified, file-listed release while the MCS instance is stopped.
import {readFile,writeFile,copyFile,mkdir,rename,unlink,access} from 'node:fs/promises';
import {resolve,relative,dirname,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createConnection} from 'node:net';
const root=resolve('C:/wx/fishbot'),nativeRoot=resolve('C:/wx/tools/fishbot-frida-research-17.25.0');
if(resolve(process.cwd()).toLowerCase()!==root.toLowerCase())throw Error('Run from the owned cloud project');
const inside=(base,path)=>{const delta=relative(base,path);return delta!==''&&delta!=='..'&&!delta.startsWith('..\\')&&!delta.startsWith('../')&&!isAbsolute(delta);};
const stage=resolve(process.argv[2]||'');if(!inside(join(root,'data/deploy'),stage))throw Error('Release stage outside owned deployment directory');
for(const port of [8765,8766]){
 const listening=await new Promise(resolveResult=>{const socket=createConnection({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();resolveResult(true);});socket.once('error',()=>resolveResult(false));});
 if(listening)throw Error('Stop the active FishBot instance before applying release');
}
if((await readFile(join(root,'data/STOP'),'utf8')).trim()!=='image-maintenance')throw Error('Image maintenance ownership is not established');
const manifest=JSON.parse(await readFile(join(stage,'manifest.json'),'utf8'));
const backup=join(root,'data/deploy','backup-images-'+Date.now());await mkdir(backup,{recursive:true});
const files=[];
for(const entry of manifest.files){
 const source=resolve(stage,entry.path);if(!inside(stage,source))throw Error('Invalid release source path');
 const bytes=await readFile(source);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Release hash mismatch');
 const native=entry.path.startsWith('runtime-native/'),base=native?nativeRoot:root,target=resolve(base,native?entry.path.slice('runtime-native/'.length):entry.path);
 if(!inside(base,target)||(!native&&!entry.path.startsWith('dist/')&&!['package.json','package-lock.json','scripts/run-cloud-all.mjs'].includes(entry.path)))throw Error('Release target is not allowed');
 files.push({source,target,backup:join(backup,entry.path)});
}
// Validate every source before changing any runtime file.
for(const file of files){
 if(await access(file.target).then(()=>true,()=>false)){await mkdir(dirname(file.backup),{recursive:true});await copyFile(file.target,file.backup);}
 await mkdir(dirname(file.target),{recursive:true});await copyFile(file.source,file.target);
}
const payloadPath=join(root,'data/deploy/image-env-patch.json');
const patch=JSON.parse(await readFile(payloadPath,'utf8'));
const allowed=new Set(['IMAGE_API_KEY','IMAGE_BASE_URL','IMAGE_MODEL','IMAGE_BACKUP_KEY','IMAGE_BACKUP_URL','IMAGE_BACKUP_MODEL','IMAGE_PROVIDER','IMAGE_TIMEOUT_MS','WECHAT_NATIVE_IMAGES','FISHBOT_WINDOWLESS']);
for(const [key,value] of Object.entries(patch))if(!allowed.has(key)||typeof value!=='string'||/[\r\n\0]/.test(value))throw Error('Invalid image configuration patch');
const envPath=join(root,'.env'),existing=await readFile(envPath,'utf8');await copyFile(envPath,join(backup,'.env'));
const lines=existing.split(/\r?\n/).filter(line=>!allowed.has(/^\s*([A-Z_]+)\s*=/.exec(line)?.[1]||''));
const merged=lines.join('\n').replace(/\n*$/,'\n')+Object.entries(patch).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n';
const temp=envPath+'.image-update.tmp';await writeFile(temp,merged,{flag:'wx',mode:0o600});await rename(temp,envPath);await unlink(payloadPath);
await writeFile(join(backup,'release.json'),JSON.stringify({appliedAt:new Date().toISOString(),fileCount:files.length,manifest:manifest.files},null,2));
console.log(JSON.stringify({applied:true,fileCount:files.length,backupDirectory:backup,maintenanceRetained:true,secretsPrinted:false}));
