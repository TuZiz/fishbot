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
const scratch=await mkdtemp(join(tmpdir(),'fishbot-media-schema-'));
let firstCached;
const result={readOnly:true,shapes:[],imageRows:0,quoteRows:0,files:{},headers:{}};
try{
 const files=(await readdir(join(storage,'message'))).filter(x=>/^message_\d+\.db$/.test(x));
 const shapes=new Set();
 for(const file of files){
  const path=join(scratch,file);await snapshotDatabase(join(storage,'message',file),path,key);const db=new DatabaseSync(path,{readOnly:true});
  try{
   for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Msg_%'").all()){
    if(!/^Msg_[a-f0-9]{32}$/.test(name))continue;
    const rows=db.prepare(`SELECT local_type,message_content FROM "${name}" WHERE (local_type & 4294967295) IN (3,49) ORDER BY local_id DESC LIMIT 10`).all();
    for(const row of rows){let text;try{text=decodeText(row.message_content);}catch{continue;}
     const quote=text.includes('<refermsg>');if(Number(BigInt(row.local_type)&4294967295n)===3)result.imageRows++;if(quote)result.quoteRows++;
     const tags=[...text.matchAll(/<\/?([a-zA-Z][\w:.-]*)\b([^<>]*?)>/g)].map(m=>({tag:m[1],attrs:[...m[2].matchAll(/\b([\w:-]+)\s*=/g)].map(a=>a[1])}));
     const shape=JSON.stringify({type:Number(BigInt(row.local_type)&4294967295n),quote,tags});if(!shapes.has(shape)){shapes.add(shape);if(result.shapes.length<12)result.shapes.push(JSON.parse(shape));}
    }
   }
  }finally{db.close();}
 }
 async function scan(dir,depth=0){if(depth>6)return;let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries){if(entry.isDirectory()){if(!['db_storage','logs','log','temp'].includes(entry.name))await scan(join(dir,entry.name),depth+1);continue;}
   const ext=/\.[a-zA-Z0-9]+$/.exec(entry.name)?.[0]?.toLowerCase()||'(none)';result.files[ext]=(result.files[ext]||0)+1;
   if(ext==='.dat'&&!firstCached)firstCached=join(dir,entry.name);
   if(ext==='.dat'&&(result.files[ext]||0)<=12){const f=await open(join(dir,entry.name),'r');try{const b=Buffer.alloc(8);await f.read(b,0,8,0);const signature=b.subarray(0,6).toString('hex');result.headers[signature]=(result.headers[signature]||0)+1;}finally{await f.close();}}
  }
 }
 await scan(dirname(storage));
}finally{await rm(scratch,{recursive:true,force:true});}
if(firstCached)await writeFile('data/image-read-probe-input.json',JSON.stringify({path:firstCached,root:dirname(storage)}));
console.log(JSON.stringify({readOnly:true,imageRows:result.imageRows,quoteRows:result.quoteRows,files:result.files,headers:result.headers}));
