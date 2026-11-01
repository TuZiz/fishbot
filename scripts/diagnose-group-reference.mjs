// Read-only metadata for the explicitly authorized memo-group image reference test.
import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {mkdtemp,rm,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {snapshotDatabase} from '../dist/adapters/wechat/database/snapshot.js';
import {tableFor,decodeText} from '../dist/adapters/wechat/database/messages.js';
import {parseImageXml} from '../dist/adapters/wechat/database/media-message.js';
import {imageCacheParts} from '../dist/adapters/wechat/database/image-cache.js';
import {XMLParser} from 'fast-xml-parser';

const group=process.argv[2]??process.env.FISHBOT_TEST_GROUP_ID;
if(!group||![process.env.FISHBOT_TEST_GROUP_ID,process.env.FISHBOT_TEST_GROUP_2_ID].filter(Boolean).includes(group))throw Error('Require an explicitly configured test group');
const scope=JSON.stringify(['group',group]);
const db=new DatabaseSync(process.env.NATIVE_DB_PATH??'data/fishbot-native.sqlite',{readOnly:true});
let messages;
try{
 if(process.argv.includes('--list-metadata')){
  const records=db.prepare("SELECT body FROM messages WHERE json_type(body,'$.quote')='object' ORDER BY rowid DESC LIMIT 8").all().map(r=>{const m=JSON.parse(r.body);return {incomingId:m.id,kind:m.kind,conversationId:m.conversationId,quoteType:m.quote.type,quoteSenderIsConversation:m.quote.senderId===m.conversationId};});
  console.log(JSON.stringify({records}));process.exit(0);
 }
 messages=db.prepare("SELECT body FROM messages WHERE scope=? AND json_extract(body,'$.quote.type')=3 ORDER BY rowid DESC LIMIT 3").all(scope).map(r=>JSON.parse(r.body));
}finally{db.close();}
const storage=process.env.WECHAT_STORAGE_PATH??(await readFile('data/wechat/storage-path.txt','utf8')).trim();
const keyPath=resolve(process.env.WECHAT_DB_KEY_FILE??'data/wechat/key.xml'),contents=(await readFile(keyPath,'utf8')).trim();
const key=contents.startsWith('<')?(await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true})).stdout.trim():contents;
const scratch=await mkdtemp(join(tmpdir(),'fishbot-group-reference-'));
const report={at:new Date().toISOString(),records:[]};
try{
 for(const message of messages){
  const record={incomingId:message.id,quoteId:message.quote.messageId,quoteSenderIsConversation:message.quote.senderId===group,quoteHasMd5:!!message.quote.image,originalRows:[]};
  let originalMd5,originalSender;
  for(const file of (await readdir(join(storage,'message'))).filter(f=>/^message_\d+\.db$/.test(f))){
   const path=join(scratch,'snapshot.sqlite');await snapshotDatabase(join(storage,'message',file),path,key);
   const snapshot=new DatabaseSync(path,{readOnly:true});
   try{
    const table=tableFor(group);if(!snapshot.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table))continue;
    const query=snapshot.prepare(`SELECT m.message_content,m.local_type,n.user_name AS sender FROM "${table}" m LEFT JOIN Name2Id n ON n.rowid=m.real_sender_id WHERE m.server_id=?`);query.setReadBigInts(true);
    for(const row of query.all(BigInt(message.quote.messageId))){
     let text=decodeText(row.message_content);if(text.startsWith(row.sender+':\n'))text=text.slice(row.sender.length+2);
     const image=parseImageXml(text);
     if(image){originalMd5=image.md5;originalSender=row.sender;}
     record.originalRows.push({type:Number(BigInt(row.local_type)&0xffffffffn),senderMatchesQuote:row.sender===message.quote.senderId,imageParsed:!!image,md5MatchesQuote:!!image&&(!message.quote.image||image.md5===message.quote.image.md5)});
    }
    for(const row of query.all(BigInt(message.id))){
     let text=decodeText(row.message_content);if(text.startsWith(row.sender+':\n'))text=text.slice(row.sender.length+2);
     const refer=new XMLParser({parseTagValue:false}).parse(text)?.msg?.appmsg?.refermsg;
     record.rawQuoteFieldNames=Object.keys(refer??{});
     record.rawQuoteHasRealChatUser=typeof refer?.realchatusr==='string'&&!!refer.realchatusr;
     record.rawQuoteFromIsConversation=refer?.fromusr===group;
     record.rawRealChatUserMatchesQuotedSender=refer?.realchatusr===message.quote.senderId;
     record.rawChatUserMatchesOriginalSender=typeof originalSender==='string'&&refer?.chatusr===originalSender;
    }
   }finally{snapshot.close();await rm(path,{force:true});}
  }
  if(originalMd5){
   const path=join(scratch,'index.sqlite');await snapshotDatabase(join(storage,'hardlink','hardlink.db'),path,key);
   const index=new DatabaseSync(path,{readOnly:true});
   try{
    const rows=index.prepare('SELECT file_name FROM image_hardlink_info_v4 WHERE md5=? OR lower(hex(md5))=?').all(originalMd5,originalMd5);
    const parts=imageCacheParts(index,originalMd5);
    record.cacheIndexRows=rows.length;record.thumbnailRows=rows.filter(r=>/_t\.dat$/i.test(r.file_name)).length;
    record.indexedOriginals=parts.length;record.originalFilesPresent=0;
    for(const part of parts){if(await stat(join(dirname(storage),'msg','attach',part[0],part[1],'Img',part[2])).then(s=>s.isFile()).catch(()=>false))record.originalFilesPresent++;}
   }finally{index.close();await rm(path,{force:true});}
  }
  const worker=new Worker(new URL('../dist/adapters/wechat/database/image-reference-worker.js',import.meta.url),{execArgv:[],workerData:{scratch:join(scratch,'worker'),message,storagePath:storage,keyPath}});
  try{
   const result=await new Promise((resolveResult,reject)=>{const timer=setTimeout(()=>reject(Error('Diagnostic timeout')),30000);worker.once('message',r=>{clearTimeout(timer);resolveResult(r);});worker.once('error',()=>{clearTimeout(timer);reject(Error('Diagnostic worker failed'));});});
   record.candidateCount=result.candidates?.length??0;record.workerError=result.error??null;
  }finally{await worker.terminate();}
  report.records.push(record);
 }
 await writeFile('data/group-reference-diagnosis.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await rm(scratch,{recursive:true,force:true});}
