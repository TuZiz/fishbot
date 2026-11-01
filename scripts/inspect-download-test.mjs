// Read-only identity/cache evidence for scoped native image metadata. Never calls native APIs.
import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,readdir,mkdtemp,rm,stat,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {snapshotDatabase} from '../dist/adapters/wechat/database/snapshot.js';
import {tableFor,decodeText} from '../dist/adapters/wechat/database/messages.js';
import {parseImageXml} from '../dist/adapters/wechat/database/media-message.js';
import {imageCacheParts} from '../dist/adapters/wechat/database/image-cache.js';

const group=process.argv[2],log=process.argv[3];
if(!/^\d{5,20}@chatroom$/.test(group??'')||!log)throw Error('Require explicit test group and research observer log');
const researchRoot=await realpath('data/research/native'),logPath=await realpath(log),rel=relative(researchRoot,logPath);
if(!rel||isAbsolute(rel)||rel.startsWith('..')||!/^image-download-observe-\d+\.stdout\.log$/.test(rel))throw Error('Expected a native image research observer log');
if((await stat(logPath)).size>5*1024*1024)throw Error('Observer log too large');
const events=(await readFile(logPath,'utf8')).split(/\r?\n/).filter(Boolean).map(s=>JSON.parse(s).payload)
  .filter(e=>e?.event==='test-image-metadata'&&e.targetMatched===true&&e.messageType===3&&/^\d{1,20}$/.test(e.serverId));
const ids=[...new Set(events.map(e=>e.serverId))];
if(!ids.length||ids.length>8)throw Error('Expected one to eight scoped test image IDs');
const storage=process.env.WECHAT_STORAGE_PATH||(await readFile('data/wechat/storage-path.txt','utf8')).trim();
const keyPath=resolve(process.env.WECHAT_DB_KEY_FILE||'data/wechat/key.xml');
let key=(await readFile(keyPath,'utf8')).trim();
if(key.startsWith('<'))key=(await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true})).stdout.trim();
const scratch=await mkdtemp(join(tmpdir(),'fishbot-download-inspect-'));let sequence=0;
async function snapshot(name,action){
  const path=join(scratch,`${sequence++}.sqlite`);
  try{await snapshotDatabase(join(storage,name),path,key);const db=new DatabaseSync(path,{readOnly:true});try{return await action(db);}finally{db.close();}}
  finally{await rm(path,{force:true});}
}
const records=ids.map(id=>({candidateId:id,rows:0,localIdMatched:false,imageParsed:false,cacheIndexRows:0,originalFiles:0,stages:[...new Set(events.filter(e=>e.serverId===id).map(e=>e.rva))],
  kinds:[...new Set(events.filter(e=>e.serverId===id).map(e=>e.kind))],priorities:[...new Set(events.filter(e=>e.serverId===id&&e.priority!==null).map(e=>e.priority))]}));
const md5s=new Map();
try{
  for(const file of (await readdir(join(storage,'message'))).filter(v=>/^message_\d+\.db$/.test(v))){
    await snapshot('message/'+file,db=>{
      const table=tableFor(group);if(!db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table))return;
      const query=db.prepare(`SELECT m.server_id,m.local_id,m.local_type,m.message_content,n.user_name AS sender FROM "${table}" m LEFT JOIN Name2Id n ON n.rowid=m.real_sender_id WHERE m.server_id IN (${ids.map(()=>'?').join(',')})`);query.setReadBigInts(true);
      for(const row of query.all(...ids.map(v=>BigInt(v)))){
        const record=records.find(r=>r.candidateId===String(row.server_id));if(!record)continue;
        record.rows++;if(Number(BigInt(row.local_type)&0xffffffffn)!==3)continue;
        let text=decodeText(row.message_content);if(text.startsWith(row.sender+':\n'))text=text.slice(row.sender.length+2);
        const image=parseImageXml(text);record.imageParsed=!!image;
        record.localIdMatched=events.some(e=>e.serverId===record.candidateId&&e.localId===Number(row.local_id));
        if(image)md5s.set(record.candidateId,image.md5);
      }
    });
  }
  await snapshot('hardlink/hardlink.db',async db=>{
    for(const record of records){
      const md5=md5s.get(record.candidateId);if(!md5||record.rows!==1||!record.localIdMatched)continue;
      record.cacheIndexRows=db.prepare('SELECT COUNT(*) AS n FROM image_hardlink_info_v4 WHERE md5=? OR lower(hex(md5))=?').get(md5,md5).n;
      for(const [a,b,file] of imageCacheParts(db,md5)){
        const path=join(dirname(storage),'msg','attach',a,b,'Img',file);
        if(await stat(path).then(s=>s.isFile(),()=>false))record.originalFiles++;
      }
    }
  });
  const identityVerified=records.length>0&&records.every(r=>r.rows===1&&r.localIdMatched&&r.imageParsed);
  const report={at:new Date().toISOString(),readOnly:true,paidRequests:0,sends:0,automaticDownloadVerified:false,identityVerified,metadataEvents:events.length,records};
  await writeFile(join(researchRoot,'image-download-identity.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{key='';await rm(scratch,{recursive:true,force:true});}
