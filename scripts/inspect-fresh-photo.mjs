// Read-only metadata for the explicitly requested test photo; no chat bodies/paths in output.
import 'dotenv/config';
import {readFile,mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {snapshotDatabase} from '../../dist/adapters/wechat/database/snapshot.js';
import {tableFor,decodeText} from '../../dist/adapters/wechat/database/messages.js';
import {parseImageXml} from '../../dist/adapters/wechat/database/media-message.js';
const after=Number(process.argv[2]);if(!Number.isFinite(after)||Date.now()-after>3600000)throw Error('Require recent test timestamp');
const storage=process.env.WECHAT_STORAGE_PATH||(await readFile('data/wechat/storage-path.txt','utf8')).trim(),keyPath=resolve(process.env.WECHAT_DB_KEY_FILE||'data/wechat/key.xml');
let key=(await readFile(keyPath,'utf8')).trim();if(key.startsWith('<'))key=(await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true})).stdout.trim();
const scratch=await mkdtemp(join(tmpdir(),'fishbot-photo-inspect-'));let seq=0;
const snapshot=async(name,action)=>{const p=join(scratch,`${seq++}.sqlite`);try{await snapshotDatabase(join(storage,name),p,key);const db=new DatabaseSync(p,{readOnly:true});try{return action(db);}finally{db.close();}}finally{await rm(p,{force:true});}};
try{
 const sessions=await snapshot('session/session.db',db=>db.prepare('SELECT username FROM SessionTable').all().map(r=>r.username).filter(n=>!n.endsWith('@chatroom')));
 let count=0,parsed=0,latest=0;const structures=[],recentTypes={};let latestPrivate=0;
 for(const file of (await readdir(join(storage,'message'))).filter(f=>/^message_\d+\.db$/.test(f))){await snapshot('message/'+file,db=>{
  for(const id of sessions){const table=tableFor(id);if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
   latestPrivate=Math.max(latestPrivate,Number(db.prepare(`SELECT COALESCE(MAX(create_time),0) AS latest FROM "${table}"`).get().latest)*1000);
   for(const row of db.prepare(`SELECT (local_type&4294967295) AS type,COUNT(*) AS n FROM "${table}" WHERE create_time>=? GROUP BY (local_type&4294967295)`).all(Math.floor(after/1000)))recentTypes[String(row.type)]=(recentTypes[String(row.type)]||0)+Number(row.n);
   const stmt=db.prepare(`SELECT m.server_id,m.create_time,m.message_content,n.user_name AS sender FROM "${table}" m LEFT JOIN Name2Id n ON n.rowid=m.real_sender_id WHERE (m.local_type&4294967295)=3 AND m.create_time>=? ORDER BY m.create_time DESC LIMIT 3`);stmt.setReadBigInts(true);
   for(const row of stmt.all(Math.floor(after/1000))){count++;latest=Math.max(latest,Number(row.create_time)*1000);let xml=decodeText(row.message_content);const image=parseImageXml(xml);if(image)parsed++;
    structures.push({parsed:!!image,xmlTags:[...xml.matchAll(/<\/?([a-zA-Z][\w:-]*)/g)].map(m=>m[1]).slice(0,20),attributeNames:[...xml.matchAll(/\s([\w:-]+)\s*=/g)].map(m=>m[1]).slice(0,35)});
    if(image&&String(row.server_id)!=='0')writeFile('data/research/images/fresh-photo-message-private.json',JSON.stringify({id:'photo-probe',kind:'private',conversationId:id,senderId:row.sender,text:'reference probe',timestamp:Date.now(),quote:{type:3,messageId:String(row.server_id),senderId:row.sender,image}}));
   }
  }
 });}
 console.log(JSON.stringify({count,parsed,latest,latestPrivate,recentTypes,structures}));
}finally{await rm(scratch,{recursive:true,force:true});}
