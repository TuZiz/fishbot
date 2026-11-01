import {parseImageXml} from '../dist/adapters/wechat/database/media-message.js';
// Independent read-only filehelper image receipt check. No chat text or keys are emitted.
import 'dotenv/config';
import {readFile,mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {snapshotDatabase} from '../dist/adapters/wechat/database/snapshot.js';
import {decodeText,tableFor} from '../dist/adapters/wechat/database/messages.js';
const storage=process.env.WECHAT_STORAGE_PATH||(await readFile('data/wechat/storage-path.txt','utf8')).trim();
const keyPath=resolve(process.env.WECHAT_DB_KEY_FILE||'data/wechat/key.xml');
let key=(await readFile(keyPath,'utf8')).trim();
if(key.startsWith('<'))key=(await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true})).stdout.trim();
const folder=await mkdtemp(join(tmpdir(),'fishbot-image-receipt-')),records=[];
try{
 for(const file of (await readdir(join(storage,'message'))).filter(f=>/^message_\d+\.db$/.test(f))){
  const path=join(folder,file);await snapshotDatabase(join(storage,'message',file),path,key);const db=new DatabaseSync(path,{readOnly:true});
  try{const table=tableFor('filehelper');if(!db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table))continue;
   const query=db.prepare(`SELECT local_type,server_id,message_content,create_time FROM "${table}" WHERE (local_type & 4294967295) IN (1,3) ORDER BY local_id DESC LIMIT 20`);query.setReadBigInts(true);
   for(const row of query.all()){const xml=decodeText(row.message_content);const md5=/<img\b[^>]*\bmd5=["']([a-fA-F0-9]{32})["']/.exec(xml)?.[1]?.toLowerCase();records.push({id:String(row.server_id),timestamp:Number(row.create_time)*1000,md5,imageParsed:!!parseImageXml(xml),type:Number(BigInt(row.local_type)&4294967295n),control:Number(row.local_type)===1&&xml.startsWith('FishBot_CloudNative_')});}
  }finally{db.close();}
 }
 if(process.argv.includes('--baseline')){await writeFile('data/image-receipt-baseline.json',JSON.stringify({at:Date.now(),ids:records.map(r=>r.id)}));console.log(JSON.stringify({baseline:true,imageRows:records.length}));}
 else {const before=JSON.parse(await readFile('data/image-receipt-baseline.json','utf8'));const md5=createHash('md5').update(await readFile(process.env.IMAGE_PROBE_FILE||'data/image-probe.png')).digest('hex');const fresh=records.filter(r=>!before.ids.includes(r.id)&&r.timestamp>=before.at-1000&&r.id!=='0');const matches=fresh.filter(r=>r.md5===md5);const report={readOnly:true,newImageCount:fresh.filter(r=>r.type===3).length,md5MatchCount:matches.length,freshImageParseFailures:fresh.filter(r=>r.type===3&&!r.imageParsed).length,receiptIds:matches.map(r=>r.id),controlTextReceipts:fresh.filter(r=>r.control).map(r=>r.id)};await writeFile('data/image-receipt-evidence.json',JSON.stringify(report));console.log(JSON.stringify(report));}
}finally{await rm(folder,{recursive:true,force:true});}
