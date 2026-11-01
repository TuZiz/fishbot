// Independent, read-only verification of the two authorized closed-window AI tests.
import 'dotenv/config';
import {readFile,readdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {readOwnedImage} from '../dist/images/owned-file.js';
import {snapshotDatabase} from '../dist/adapters/wechat/database/snapshot.js';
import {tableFor,readNewMessages} from '../dist/adapters/wechat/database/messages.js';

const groupId=process.argv.includes('--railway-test-group')?process.env.FISHBOT_TEST_GROUP_2_ID:process.env.FISHBOT_TEST_GROUP_ID;
const groupOnly=process.argv.includes('--group-only');
if(!groupId||(!groupOnly&&!process.env.FISHBOT_TEST_FRIEND_ID))throw Error('Configure authorized test targets before verification');
const scopes=new Set(groupOnly?[groupId]:[process.env.FISHBOT_TEST_FRIEND_ID,groupId]);
const port=process.argv.includes('--main-runtime')?8765:8766;
const response=await fetch(`http://127.0.0.1:${port}/replies`,{headers:{'x-fishbot-token':process.env.INGEST_TOKEN},signal:AbortSignal.timeout(5000)});
if(!response.ok)throw Error('Runtime replies unavailable');
const incomingId=process.argv.find(arg=>arg.startsWith('--incoming-id='))?.slice('--incoming-id='.length);
const jobs=(await response.json()).filter(j=>scopes.has(j.target)&&(!incomingId||[incomingId,incomingId+':image-wait',incomingId+':image'].includes(j.incoming)));
if(!jobs.length)throw Error('No authorized test replies yet');
const storage=process.env.WECHAT_STORAGE_PATH??(await readFile('data/wechat/storage-path.txt','utf8')).trim();
const keyPath=process.env.WECHAT_DB_KEY_FILE??'data/wechat/key.xml',contents=(await readFile(keyPath,'utf8')).trim();
const key=contents.startsWith('<')?(await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true})).stdout.trim():contents;
const report={checkedAt:new Date().toISOString(),version:'4.1.15.56',independentSnapshot:true,windowsClosedByUser:process.argv.includes('--windows-closed-confirmed'),remoteDeviceDeliveryVerified:false,records:[],errors:[]};
const folder=await mkdtemp(join(tmpdir(),'fishbot-windowless-verify-'));
try{
 const observed=[];
 for(const file of (await readdir(join(storage,'message'))).filter(f=>/^message_\d+\.db$/.test(f))){
  try{
   const destination=join(folder,'snapshot.sqlite');await snapshotDatabase(join(storage,'message',file),destination,key);
   const db=new DatabaseSync(destination,{readOnly:true});
   try{
    const account=basename(dirname(storage));const self=db.prepare('SELECT user_name FROM Name2Id').all().map(r=>String(r.user_name)).filter(id=>account===id||account.startsWith(id+'_'));
    if(self.length!==1)throw Error('Ambiguous self account');
    for(const id of scopes){const table=tableFor(id);if(!db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table))continue;
     const max=Number(db.prepare(`SELECT COALESCE(MAX(local_id),0) AS n FROM "${table}"`).get().n);
     observed.push(...readNewMessages(db,id,Math.max(0,max-30),self[0],file).messages);
    }
   }finally{db.close();}
  }catch(error){report.errors.push({file,reason:error instanceof Error?error.message:'Snapshot failed'});}
 }
 report.recentGroupInputs=observed.filter(m=>m.kind==='group'&&m.timestamp>=Math.min(...jobs.map(j=>j.created))-30000).map(m=>({id:m.id,target:m.conversationId,timestamp:m.timestamp,isSelf:m.isSelf,mentionedBot:m.mentionedBot,acceptanceMarkerMatched:m.text.includes('后台群聊验收')}));
 for(const job of jobs){
  const result=job.result?JSON.parse(job.result):{};
  const inputId=job.incoming.replace(/:image(?:-wait)?$/,'');
  const input=observed.find(m=>m.id===inputId&&m.conversationId===job.target&&!m.isSelf);
  const image=job.kind==='image'?await readOwnedImage(job.text):undefined;
  const md5=image?createHash('md5').update(image.bytes).digest('hex'):undefined;
  const output=observed.find(m=>m.id===result.messageId&&m.conversationId===job.target&&m.isSelf&&(job.kind==='image'?!!md5&&m.image?.md5===md5:m.text===job.text));
  report.records.push({kind:job.target.endsWith('@chatroom')?'group':'private',mediaKind:job.kind,created:job.created,waiting:job.incoming.endsWith(':image-wait'),target:job.target,incomingId:job.incoming,realIncomingVerified:!!input,mentionedBot:input?.mentionedBot??false,status:job.status,attempts:job.attempts,replyId:result.messageId,independentDatabaseEcho:!!output});
 }
}finally{await rm(folder,{recursive:true,force:true});}
report.passed=report.errors.length===0&&(groupOnly?['group']:['private','group']).every(kind=>report.records.some(r=>r.kind===kind&&r.realIncomingVerified&&r.status==='sent'&&r.attempts===1&&r.independentDatabaseEcho&&(kind!=='group'||r.mentionedBot)));
if(process.argv.includes('--image-workflow')){
 const verified=r=>r.realIncomingVerified&&r.status==='sent'&&r.attempts===1&&r.independentDatabaseEcho;
 report.imageWorkflowPassed=report.records.some(image=>image.mediaKind==='image'&&verified(image)&&report.records.some(wait=>wait.waiting&&verified(wait)&&wait.target===image.target&&wait.incomingId.replace(/:image-wait$/,'')===image.incomingId.replace(/:image$/,'')&&wait.created<=image.created));
 report.passed&&=report.imageWorkflowPassed;
}
await writeFile('data/windowless-runtime-evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
