// Read-only receipt verification for the one explicit synthetic native probe.
import 'dotenv/config';
import {readFile,readdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {snapshotDatabase} from '../dist/adapters/wechat/database/snapshot.js';
import {tableFor,decodeText} from '../dist/adapters/wechat/database/messages.js';

const probePath=process.argv[2];
if(!probePath)throw Error('Provide the JSON probe report path');
const probe=JSON.parse((await readFile(probePath,'utf8')).replace(/^\uFEFF/,''));
if(!/^FishBot_Windowless_\d+$/.test(probe.marker??'')||!probe.send?.attempted)throw Error('Expected an attempted synthetic filehelper probe');
const storage=process.env.WECHAT_STORAGE_PATH??(await readFile('data/wechat/storage-path.txt','utf8')).trim();
const keyPath=process.env.WECHAT_DB_KEY_FILE??'data/wechat/key.xml';
const contents=(await readFile(keyPath,'utf8')).trim();
const key=contents.startsWith('<')?(await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true})).stdout.trim():contents;
const folder=await mkdtemp(join(tmpdir(),'fishbot-windowless-receipt-'));
const report={target:'filehelper',marker:probe.marker,confirmed:false,independentSnapshot:true,nativeOutcome:probe.send,remoteDeviceDeliveryVerified:false,errors:[]};
try{
 for(let pass=0;pass<3&&!report.confirmed;pass++){
  for(const file of (await readdir(join(storage,'message'))).filter(f=>/^message_\d+\.db$/.test(f))){
   try{
    const path=join(folder,'snapshot.sqlite');await snapshotDatabase(join(storage,'message',file),path,key);
    const db=new DatabaseSync(path,{readOnly:true});
    try{
     const table=tableFor('filehelper');if(!db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table))continue;
     const account=basename(dirname(storage));const self=db.prepare('SELECT user_name FROM Name2Id').all().map(r=>String(r.user_name)).filter(id=>account===id||account.startsWith(id+'_'));
     if(self.length!==1)throw Error('Self account ambiguous');
     const statement=db.prepare(`SELECT m.server_id,m.message_content,m.create_time,n.user_name AS sender FROM "${table}" m LEFT JOIN Name2Id n ON n.rowid=m.real_sender_id ORDER BY m.local_id DESC LIMIT 20`);statement.setReadBigInts(true);
     for(const row of statement.all()){
      if(row.sender!==self[0]||!row.server_id||!/^[1-9]\d+$/.test(String(row.server_id)))continue;
      if(decodeText(row.message_content)===probe.marker){report.confirmed=true;report.messageId=String(row.server_id);report.timestamp=Number(row.create_time)*1000;break;}
     }
    }finally{db.close();}
   }catch(error){report.errors.push({pass,file,reason:error instanceof Error?error.message:'Snapshot failed'});}
   if(report.confirmed)break;
  }
  if(!report.confirmed)await new Promise(r=>setTimeout(r,1000));
 }
}finally{await rm(folder,{recursive:true,force:true});}
await writeFile('data/windowless-filehelper-receipt.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(!report.confirmed)process.exitCode=1;
