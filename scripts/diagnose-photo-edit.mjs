// Retrospective metadata only. No prompts, account IDs, paths, keys or image bytes are printed.
import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {imageIntent} from '../../dist/images/intent.js';
import {Worker} from 'node:worker_threads';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {dirname} from 'node:path';
import {normalizeCachedImage} from '../../dist/images/cached-format.js';
const db=new DatabaseSync(process.env.NATIVE_DB_PATH,{readOnly:true});
try{
 const job=db.prepare("SELECT incoming,scope,text,status,attempts FROM outbox WHERE kind='image' ORDER BY id DESC LIMIT 1").get();
 const id=job.incoming.replace(/:image$/,'');
 const row=db.prepare('SELECT body FROM messages WHERE scope=? AND id=?').get(job.scope,id);
 const message=JSON.parse(row.body),fixture=JSON.parse(await readFile('data/research/images/received-image-probe-private.json','utf8'));
 const intent=imageIntent(message.text);
 const generated=message.quote?db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE scope=? AND kind='image' AND status='sent' AND json_extract(result,'$.messageId')=?").get(job.scope,message.quote.messageId).n:0;
 const worker=new Worker(new URL('../../dist/adapters/wechat/database/image-reference-worker.js',import.meta.url),{execArgv:[],workerData:{scratch:join(tmpdir(),'fishbot-image-diagnosis-'+randomUUID()),message,storagePath:process.env.WECHAT_STORAGE_PATH,keyPath:process.env.WECHAT_DB_KEY_FILE}});
 let original;
 try{original=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',()=>reject(Error('Reference diagnostic failed')));});}finally{await worker.terminate();}
 const report={at:new Date().toISOString(),intent:!!intent,operation:intent?.edit?'edit':'generate',hasQuote:!!message.quote,quoteType:message.quote?.type,quoteHasMd5:!!message.quote?.image?.md5,quoteMd5MatchesTestPhoto:message.quote?.image?.md5===fixture.md5,resolvedMd5MatchesTestPhoto:original.md5===fixture.md5,resolvedPathMatchesTestPhoto:original.candidates?.includes(fixture.path),candidateCount:original.candidates?.length,quotedBotGenerated:generated>0,outputStatus:job.status,attempts:job.attempts,outputBytes:(await readFile(job.text)).length};
 await writeFile('data/research/images/photo-edit-diagnosis.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(process.argv.includes('--inspect-images')&&original.candidates?.length===1){
  const storage=process.env.WECHAT_STORAGE_PATH||(await readFile('data/wechat/storage-path.txt','utf8')).trim();
  const input='C:/wx/fishbot/data/research/images/actual-reference-private.json';
  await writeFile(input,JSON.stringify({path:original.candidates[0],root:join(dirname(storage),'msg','attach'),md5:original.md5}));
  const root='C:/wx/tools/fishbot-frida-research-17.25.0';
  const {stdout}=await promisify(execFile)('C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe',[root+'/probe-image-read.py','--root',root,'--dependencies',root,'--input-json',input,'--reader-module','--json-bytes'],{windowsHide:true,maxBuffer:29_000_000,timeout:15000});
  const raw=JSON.parse(stdout);if(!raw.matchesExpectedMD5)throw Error('Diagnostic identity mismatch');
  await writeFile('data/research/images/actual-reference-review.wxgf',Buffer.from(raw.base64,'base64'));
  const reference=await normalizeCachedImage(Buffer.from(raw.base64,'base64'),'C:/wx/tools/imageio-ffmpeg-0.6.0/ffmpeg-win-x86_64-v7.1.exe');
  await writeFile('data/research/images/actual-reference-review.png',reference.bytes);
  await writeFile('data/research/images/actual-output-review.png',await readFile(job.text));
  console.log(JSON.stringify({privateReviewReady:true,sourceFormat:raw.format,width:reference.bytes.readUInt32BE(16),height:reference.bytes.readUInt32BE(20)}));
 }
}finally{db.close();}
