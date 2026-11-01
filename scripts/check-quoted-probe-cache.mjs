// Research-only cache check for the exact previously DB-verified reference.
// Does not print identities, cache paths, URLs, keys or image bytes.
import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Worker} from 'node:worker_threads';

const expected=JSON.parse(await readFile('data/research/native/quoted-image-identity-input.json','utf8'));
if(![process.env.FISHBOT_TEST_GROUP_ID,process.env.FISHBOT_TEST_GROUP_2_ID].filter(Boolean).includes(expected.conversationId))throw Error('Unauthorized probe conversation');
const db=new DatabaseSync(process.env.NATIVE_DB_PATH??'data/fishbot-native.sqlite',{readOnly:true});
let message;
try{
  const rows=db.prepare("SELECT body FROM messages WHERE scope=? AND json_extract(body,'$.quote.messageId')=? ORDER BY rowid DESC LIMIT 1").all(JSON.stringify(['group',expected.conversationId]),expected.serverId);
  if(rows.length!==1)throw Error('Prepared reference no longer available');
  message=JSON.parse(rows[0].body);
}finally{db.close();}
// Preparation reparses the quote from the original read-only DB snapshot.
message=JSON.parse(await readFile('data/research/native/quoted-image-probe-message.json','utf8'));
if(message.quote?.senderId!==expected.senderId||message.quote?.type!==3)throw Error('Reference identity changed');
const scratch=await mkdtemp(join(tmpdir(),'fishbot-probe-cache-'));
const worker=new Worker(new URL('../dist/adapters/wechat/database/image-reference-worker.js',import.meta.url),{execArgv:[],workerData:{scratch,message,storagePath:process.env.WECHAT_STORAGE_PATH,keyPath:process.env.WECHAT_DB_KEY_FILE}});
try{
  const result=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Probe cache check timeout')),30000);
    worker.once('message',r=>{clearTimeout(timer);resolve(r);});
    worker.once('error',()=>{clearTimeout(timer);reject(Error('Probe cache worker failed'));});
    worker.once('exit',()=>{clearTimeout(timer);reject(Error('Probe cache worker exited'));});
  });
  if(result.error||result.md5!==expected.md5)throw Error('Probe cache identity unavailable');
  await writeFile('data/research/native/quoted-cache-private.json',JSON.stringify({md5:expected.md5,candidates:result.candidates}));
  const report={at:new Date().toISOString(),identityVerified:true,nonThumbnailCandidates:result.candidates.length,downloads:0,sends:0,paidRequests:0};
  const output=process.argv[2];
  if(output&&!/^data[\/]research[\/]native[\/][a-z0-9-]+\.json$/.test(output))throw Error('Invalid report destination');
  if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{await worker.terminate();await rm(scratch,{recursive:true,force:true});}
