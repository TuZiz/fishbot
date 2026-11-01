// Select only a fresh incoming photo explicitly supplied for this test. Never print its body/path.
import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
const stage=resolve(process.argv[2]),after=Number(process.argv[3]);
if(!Number.isFinite(after)||Date.now()-after>3600000||after>Date.now())throw Error('Require a recent explicit test start time');
const dbPath=process.env.NATIVE_DB_PATH;
if(!dbPath)throw Error('Main runtime database path unavailable');
const db=new DatabaseSync(dbPath,{readOnly:true});let message;
try{
 const rows=db.prepare("SELECT body FROM messages WHERE json_extract(body,'$.timestamp')>=? AND json_extract(body,'$.kind')='private' AND json_extract(body,'$.isSelf')=0 AND json_type(body,'$.image')='object' ORDER BY CAST(json_extract(body,'$.timestamp') AS INTEGER) DESC LIMIT 2").all(after);
 if(rows.length!==1){console.log(JSON.stringify({freshImageCount:rows.length,ready:false,stored:db.prepare("SELECT COUNT(*) AS total,MAX(CAST(json_extract(body,'$.timestamp') AS INTEGER)) AS latest,SUM(CASE WHEN json_type(body,'$.image')='object' THEN 1 ELSE 0 END) AS images FROM messages").get()}));process.exit(0);}
 const photo=JSON.parse(rows[0].body);
 message={...photo,id:'cached-original-probe',image:undefined,text:'reference probe',quote:{messageId:photo.id,senderId:photo.senderId,type:3,image:photo.image}};
}finally{db.close();}
const scratch=join(tmpdir(),'fishbot-image-probe-'+randomUUID());
const worker=new Worker(new URL('file:///'+join(stage,'dist/adapters/wechat/database/image-reference-worker.js').replaceAll('\\','/')),{execArgv:[],workerData:{scratch,message,storagePath:process.env.WECHAT_STORAGE_PATH,keyPath:process.env.WECHAT_DB_KEY_FILE}});
try{
 const report=await new Promise((resolveResult,reject)=>{
  const timer=setTimeout(()=>reject(Error('Probe snapshot timeout')),30000);
  worker.once('message',r=>{clearTimeout(timer);resolveResult(r);});worker.once('error',()=>{clearTimeout(timer);reject(Error('Probe worker failed'));});worker.once('exit',()=>{clearTimeout(timer);reject(Error('Probe worker exited'));});
 });
 if(report.error)throw Error(report.error);
 console.log(JSON.stringify({freshImageCount:1,cachedOriginalCandidates:report.candidates.length,ready:report.candidates.length>0}));
 if(report.candidates.length){
  const storage=process.env.WECHAT_STORAGE_PATH||(await readFile('data/wechat/storage-path.txt','utf8')).trim();
  await mkdir('data/research/images',{recursive:true});
  await writeFile('data/research/images/received-image-probe-private.json',JSON.stringify({path:report.candidates[0],root:join(dirname(storage),'msg','attach'),md5:report.md5}));
 }
}finally{await worker.terminate();await rm(scratch,{recursive:true,force:true});}
