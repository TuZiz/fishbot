import {parentPort,workerData} from 'node:worker_threads';
import {readFile,mkdir,rm,readdir,realpath,stat} from 'node:fs/promises';
import {join,dirname,resolve,relative,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {snapshotDatabase} from './snapshot.js';
import {quotedImageMd5,imageCacheParts} from './image-cache.js';
import {tableFor} from './messages.js';
import {incomingSchema} from '../../../schema.js';

const {scratch,storagePath,keyPath,message}=workerData;
await mkdir(scratch,{recursive:true});
let sequence=0;
try{
  const storage=storagePath||(await readFile('data/wechat/storage-path.txt','utf8')).trim();
  const path=resolve(keyPath||'data/wechat/key.xml');
  const contents=(await readFile(path,'utf8')).trim();
  const key=contents.startsWith('<')?(await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${path.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true})).stdout.trim():contents;
  async function snapshot<T>(name:string,read:(db:DatabaseSync)=>T){
    const copy=join(scratch,`${sequence++}.sqlite`);
    try{await snapshotDatabase(join(storage,name),copy,key);const db=new DatabaseSync(copy,{readOnly:true});try{return read(db);}finally{db.close();}}finally{await rm(copy,{force:true});}
  }
  const parsed=incomingSchema.parse(message),matches:{md5:string;localId:number}[]=[];
  for(const file of (await readdir(join(storage,'message'))).filter(v=>/^message_\d+\.db$/.test(v))){
    const identity=await snapshot('message/'+file,db=>{
      const md5=quotedImageMd5(db,parsed);if(!md5)return;
      const query=db.prepare(`SELECT local_id FROM "${tableFor(parsed.conversationId)}" WHERE server_id=? LIMIT 2`);query.setReadBigInts(true);
      const rows=query.all(BigInt(parsed.quote!.messageId));
      const localId=rows.length===1?Number(rows[0]!.local_id):0;
      if(!Number.isSafeInteger(localId)||localId<1||localId>0xffffffff)return;
      return {md5,localId};
    });if(identity)matches.push(identity);
  }
  if(matches.length!==1){parentPort!.postMessage({candidates:[]});}
  else{
    const {md5,localId}=matches[0]!,parts=await snapshot('hardlink/hardlink.db',db=>imageCacheParts(db,md5));
    const root=await realpath(join(dirname(storage),'msg','attach')),candidates:string[]=[];
    for(const [a,b,file] of parts){
      const candidate=await realpath(join(root,a!,b!,'Img',file!)).catch(()=>undefined);if(!candidate)continue;
      const rel=relative(root,candidate);if(!rel||rel.startsWith('..')||isAbsolute(rel))continue;
      const info=await stat(candidate);if(info.isFile()&&info.size>=15&&info.size<=20*1024*1024)candidates.push(candidate);
    }
    parentPort!.postMessage({md5,identity:{md5,localId,conversationId:parsed.conversationId,senderId:parsed.quote!.senderId,serverId:parsed.quote!.messageId},candidates:[...new Set(candidates)]});
  }
}catch{parentPort!.postMessage({error:'Cached image snapshot unavailable'});}
finally{await rm(scratch,{recursive:true,force:true});parentPort!.close();}
