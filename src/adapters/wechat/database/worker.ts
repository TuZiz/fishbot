import {parentPort,workerData} from 'node:worker_threads';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdtemp,rm,readdir,mkdir} from 'node:fs/promises';
import {resolve,join,basename,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {snapshotDatabase} from './snapshot.js';
import {tableFor,readNewMessages,initialCursor} from './messages.js';
const port=parentPort!;let stopped=false,scopes:string[]=[],generation=0;
const snapshotRoot=workerData?.snapshotRoot;
if(typeof snapshotRoot!=='string')throw Error('Database worker requires an owned snapshot directory');
await mkdir(snapshotRoot,{recursive:true});
const cursors=new Map<string,number>();
const pendingSelf=new Map<string,number[]>();
const baselined=new Set<string>();
const emptyAtBaseline=new Set<string>();
const keyPath=typeof workerData?.keyPath==='string'?workerData.keyPath:resolve('data/wechat/key.xml');
const keyContents=(await readFile(keyPath,'utf8')).trim();
const key=keyContents.startsWith('<')
  ?(await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true})).stdout.trim()
  :keyContents;
const storage=typeof workerData?.storagePath==='string'?workerData.storagePath:(await readFile('data/wechat/storage-path.txt','utf8')).trim();
port.on('message',m=>{if(m.type==='stop'){stopped=true;generation++;}if(m.type==='watch'){scopes=m.scopes;generation=m.generation;cursors.clear();pendingSelf.clear();baselined.clear();emptyAtBaseline.clear();for(const [key,value] of Object.entries(m.cursors??{})){if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)cursors.set(key,value);}for(const [key,value] of Object.entries(m.pendingSelf??{})){if(Array.isArray(value)&&value.length<=200&&value.every(n=>Number.isSafeInteger(n)&&n>0))pendingSelf.set(key,value);}}});
async function withSnapshot<T>(name:string,action:(db:DatabaseSync)=>T){const folder=await mkdtemp(join(snapshotRoot,'scan-'));try{const path=join(folder,'snapshot.sqlite');await snapshotDatabase(join(storage,name),path,key);const db=new DatabaseSync(path,{readOnly:true});try{return action(db);}finally{db.close();}}finally{await rm(folder,{recursive:true,force:true});}}
try{
 const contacts=await withSnapshot('contact/contact.db',db=>db.prepare('SELECT username,remark,nick_name FROM contact').all());
 const sessions=await withSnapshot('session/session.db',db=>db.prepare('SELECT username FROM SessionTable').all());
 port.postMessage({type:'sessions',sessions:sessions.map(s=>{const c=contacts.find(c=>c.username===s.username);return {id:s.username,kind:String(s.username).endsWith('@chatroom')?'group':'private',name:c?.remark||c?.nick_name||s.username};})});

 while(!stopped){
  const current=generation;
  try{
  const files=(await readdir(join(storage,'message'))).filter(n=>/^message_\d+\.db$/.test(n));
  const foundTables=new Set<string>();
  if(scopes.length)for(const file of files){if(stopped)break;await withSnapshot('message/'+file,db=>{
   if(generation!==current)return;
   const names=db.prepare('SELECT user_name FROM Name2Id').all().map(n=>String(n.user_name)),account=basename(dirname(storage));
   const candidates=names.filter(n=>account===n||account.startsWith(n+'_'));if(candidates.length!==1)throw new Error('Cannot unambiguously identify self account');const self=candidates[0]!;
   for(const id of scopes){const table=tableFor(id);if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;foundTables.add(id);
    const cursorId=file+':'+table;
    const fresh=!cursors.has(cursorId);
    const appearedAfterBaseline=emptyAtBaseline.has(id);
    if(fresh)cursors.set(cursorId,initialCursor(Number(db.prepare(`SELECT COALESCE(MAX(local_id),0) AS n FROM "${table}"`).get()!.n),appearedAfterBaseline));
    if(!baselined.has(id)){baselined.add(id);port.postMessage({type:'baseline',id,generation:current});}
    if(fresh&&!appearedAfterBaseline){port.postMessage({type:'cursor',key:cursorId,value:cursors.get(cursorId),generation:current});continue;}
    const result=readNewMessages(db,id,cursors.get(cursorId)!,self,file,pendingSelf.get(cursorId));
    if(generation!==current)return;
    cursors.set(cursorId,result.cursor);pendingSelf.set(cursorId,result.pendingSelfIds);for(const message of result.messages)port.postMessage({type:'message',message,generation:current});
    if(result.skipped)port.postMessage({type:'skipped',count:result.skipped,generation:current});
    port.postMessage({type:'cursor',key:cursorId,value:result.cursor,pendingSelf:result.pendingSelfIds,generation:current});
   }
  });}
  if(generation===current&&scopes.length)for(const id of scopes)if(!foundTables.has(id)){
   emptyAtBaseline.add(id);
   if(!baselined.has(id)){baselined.add(id);port.postMessage({type:'baseline',id,generation:current});}
  }
  port.postMessage({type:'healthy',generation:current});
  }catch(error){port.postMessage({type:'failure',reason:error instanceof Error?error.message:'Database snapshot failed',generation:current});}
  if(!stopped)await new Promise(r=>setTimeout(r,3000));
 }
}catch(error){port.postMessage({type:'failure',reason:error instanceof Error?error.message:'Database observer failure'});}finally{port.close();}

