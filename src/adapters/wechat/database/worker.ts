import {parentPort} from 'node:worker_threads';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdtemp,rm,readdir} from 'node:fs/promises';
import {resolve,join,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {snapshotDatabase} from './snapshot.js';
import {tableFor,readNewMessages} from './messages.js';
const port=parentPort!;let stopped=false,scopes:string[]=[],generation=0;
const cursors=new Map<string,number>();
const keyPath=resolve('data/wechat/key.xml');
const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true});
const key=stdout.trim(),storage=(await readFile('data/wechat/storage-path.txt','utf8')).trim();
port.on('message',m=>{if(m.type==='stop'){stopped=true;generation++;}if(m.type==='watch'){scopes=m.scopes;generation++;cursors.clear();}});
async function withSnapshot<T>(name:string,action:(db:DatabaseSync)=>T){const folder=await mkdtemp(join(tmpdir(),'fishbot-inbox-'));try{const path=join(folder,'snapshot.sqlite');await snapshotDatabase(join(storage,name),path,key);const db=new DatabaseSync(path,{readOnly:true});try{return action(db);}finally{db.close();}}finally{await rm(folder,{recursive:true,force:true});}}
try{
 const contacts=await withSnapshot('contact/contact.db',db=>db.prepare('SELECT username,remark,nick_name FROM contact').all());
 const sessions=await withSnapshot('session/session.db',db=>db.prepare('SELECT username FROM SessionTable').all());
 port.postMessage({type:'sessions',sessions:sessions.map(s=>{const c=contacts.find(c=>c.username===s.username);return {id:s.username,kind:String(s.username).endsWith('@chatroom')?'group':'private',name:c?.remark||c?.nick_name||s.username};})});

 while(!stopped){
  const current=generation;
  try{
  const files=(await readdir(join(storage,'message'))).filter(n=>/^message_\d+\.db$/.test(n));
  if(scopes.length)for(const file of files){if(stopped)break;await withSnapshot('message/'+file,db=>{
   if(generation!==current)return;
   const names=db.prepare('SELECT user_name FROM Name2Id').all().map(n=>String(n.user_name)),account=basename(dirname(storage));
   const candidates=names.filter(n=>account===n||account.startsWith(n+'_'));if(candidates.length!==1)throw new Error('Cannot unambiguously identify self account');const self=candidates[0]!;
   for(const id of scopes){const table=tableFor(id);if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    const cursorId=file+':'+table;
    if(!cursors.has(cursorId)){cursors.set(cursorId,Number(db.prepare(`SELECT COALESCE(MAX(local_id),0) AS n FROM "${table}"`).get()!.n));port.postMessage({type:'baseline',id});continue;}
    const result=readNewMessages(db,id,cursors.get(cursorId)!,self,file);
    if(generation!==current)return;
    cursors.set(cursorId,result.cursor);for(const message of result.messages)port.postMessage({type:'message',message});
    if(result.skipped)port.postMessage({type:'skipped',count:result.skipped});
   }
  });}
  port.postMessage({type:'healthy'});
  }catch(error){port.postMessage({type:'failure',reason:error instanceof Error?error.message:'Database snapshot failed'});}
  if(!stopped)await new Promise(r=>setTimeout(r,3000));
 }
}catch(error){port.postMessage({type:'failure',reason:error instanceof Error?error.message:'Database observer failure'});}finally{port.close();}

