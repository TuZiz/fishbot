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
const {createHash}=await import('node:crypto');
const md5=createHash('md5').update(await readFile('data/windowless-gradient-test.png')).digest('hex');
const scratch=await mkdtemp(join(tmpdir(),'fishbot-synthetic-cache-'));const report={readOnly:true,matches:0,existingFiles:0};const paths=[];
try{
 const path=join(scratch,'hardlink.sqlite');await snapshotDatabase(join(storage,'hardlink/hardlink.db'),path,key);const db=new DatabaseSync(path,{readOnly:true});
 try{
 const rows=db.prepare('SELECT h.file_name,a.username AS dir1,b.username AS dir2,h.type,h.file_size FROM image_hardlink_info_v4 h LEFT JOIN dir2id a ON h.dir1=a.rowid LEFT JOIN dir2id b ON h.dir2=b.rowid WHERE h.md5=? OR lower(hex(h.md5))=?').all(md5,md5);report.matches=rows.length;
 for(const row of rows){
  const parts=[row.dir1,row.dir2,row.file_name];if(parts.some(v=>typeof v!=='string'||v.includes('..')||/[\\/]/.test(v)))continue;
  const root=join(dirname(storage),'msg','attach'),file=join(root,...parts.slice(0,2),'Img',parts[2]);
  if(await open(file,'r').then(async f=>{await f.close();return true;},()=>false)){report.existingFiles++;paths.push(file);await writeFile('data/image-read-probe-input.json',JSON.stringify({path:file,paths,root,md5}));}
 }
 }finally{db.close();}
}finally{await rm(scratch,{recursive:true,force:true});}
console.log(JSON.stringify(report));
