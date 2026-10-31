import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {snapshotDatabase} from '../dist/adapters/wechat/database/snapshot.js';
const keyPath=resolve('data/wechat/key.xml');
const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true});
const storage=(await readFile('data/wechat/storage-path.txt','utf8')).trim();const folder=await mkdtemp(join(tmpdir(),'fishbot-schema-'));const report=[];
try{
 for(const name of ['message/message_0.db','message/message_resource.db','contact/contact.db','session/session.db']){
  const path=join(folder,name.replaceAll('/','-'));await snapshotDatabase(join(storage,name),path,stdout.trim());const db=new DatabaseSync(path,{readOnly:true});
  try{const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name));const representatives=[...new Set(tables.map(t=>t.startsWith('Msg_')?'Msg_*':t))];
   const schemas=representatives.map(label=>{const table=label==='Msg_*'?tables.find(t=>t.startsWith('Msg_')):label;return {table:label,columns:db.prepare(`PRAGMA table_info("${table.replaceAll('"','""')}")`).all().map(r=>({name:r.name,type:r.type}))};});
   report.push({database:name,integrity:db.prepare('PRAGMA quick_check').get(),tableCount:tables.length,schemas});
  }finally{db.close();}
 }
 await writeFile('data/wechat/schema-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await rm(folder,{recursive:true,force:true});}
