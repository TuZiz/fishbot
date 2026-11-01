// Read-only schema/media evidence. Does not print messages, IDs, URLs, keys or account paths.
import 'dotenv/config';
import {readFile,mkdtemp,rm,readdir,open,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {snapshotDatabase} from '../dist/adapters/wechat/database/snapshot.js';
import {decodeText} from '../dist/adapters/wechat/database/messages.js';
const storage=process.env.WECHAT_STORAGE_PATH||(await readFile('data/wechat/storage-path.txt','utf8')).trim();
const keyPath=resolve(process.env.WECHAT_DB_KEY_FILE||'data/wechat/key.xml');
let key=(await readFile(keyPath,'utf8')).trim();
if(key.startsWith('<'))key=(await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true})).stdout.trim();
const scratch=await mkdtemp(join(tmpdir(),'fishbot-media-index-'));
const result={readOnly:true,topDirectories:await readdir(storage),indexes:[]};
try{
 for(const file of ['hardlink/hardlink.db','message/message_resource.db','message/hardlink.db']){
  if(!await open(join(storage,file),'r').then(async h=>{await h.close();return true;},()=>false))continue;
  const path=join(scratch,file.replaceAll('/','-'));await snapshotDatabase(join(storage,file),path,key);const db=new DatabaseSync(path,{readOnly:true});
  try{result.indexes.push({file,tables:db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t=>({table:t.name,columns:db.prepare('PRAGMA table_info(\"'+String(t.name).replaceAll('\"','\"\"')+'\")').all().map(c=>c.name)}))});}finally{db.close();}
 }
}finally{await rm(scratch,{recursive:true,force:true});}
console.log(JSON.stringify(result));
