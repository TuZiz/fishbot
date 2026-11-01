// Prepare identity comparisons for ONE already quoted test photo. No native calls or downloads.
import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,readdir,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {snapshotDatabase} from '../dist/adapters/wechat/database/snapshot.js';
import {tableFor,decodeText} from '../dist/adapters/wechat/database/messages.js';
import {parseQuoteXml} from '../dist/adapters/wechat/database/media-message.js';
import {quotedImageMd5} from '../dist/adapters/wechat/database/image-cache.js';
import {incomingSchema} from '../dist/schema.js';

const group=process.argv[2];
if(![process.env.FISHBOT_TEST_GROUP_ID,process.env.FISHBOT_TEST_GROUP_2_ID].filter(Boolean).includes(group))throw Error('Require an authorized test conversation');
const app=new DatabaseSync(process.env.NATIVE_DB_PATH??'data/fishbot-native.sqlite',{readOnly:true});
let message;
try{
  const row=app.prepare("SELECT body FROM messages WHERE scope=? AND json_extract(body,'$.quote.type')=3 ORDER BY rowid DESC LIMIT 1").get(JSON.stringify(['group',group]));
  if(!row)throw Error('No quoted photo in the selected test conversation');
  message=incomingSchema.parse(JSON.parse(row.body));
}finally{app.close();}
if(message.conversationId!==group||message.quote?.type!==3)throw Error('Quote scope mismatch');
const storage=process.env.WECHAT_STORAGE_PATH||(await readFile('data/wechat/storage-path.txt','utf8')).trim();
const keyPath=resolve(process.env.WECHAT_DB_KEY_FILE||'data/wechat/key.xml');
let key=(await readFile(keyPath,'utf8')).trim();
if(key.startsWith('<'))key=(await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true})).stdout.trim();
const scratch=await mkdtemp(join(tmpdir(),'fishbot-quoted-identity-'));
try{
  const matches=[];
  for(const file of (await readdir(join(storage,'message'))).filter(f=>/^message_\d+\.db$/.test(f))){
    const path=join(scratch,'snapshot.sqlite');
    try{
      await snapshotDatabase(join(storage,'message',file),path,key);
      const db=new DatabaseSync(path,{readOnly:true});
      try{
        const table=tableFor(group);
        if(!db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table))continue;
        // Reparse the original incoming quote for research only. Never replay
        // the stored instruction or trust a sender supplied on the command line.
        const incoming=db.prepare(`SELECT m.message_content,n.user_name AS sender FROM "${table}" m LEFT JOIN Name2Id n ON n.rowid=m.real_sender_id WHERE m.server_id=? LIMIT 2`);
        incoming.setReadBigInts(true);
        const incomingRows=incoming.all(BigInt(message.id));
        if(incomingRows.length===1){
          let xml=decodeText(incomingRows[0].message_content);
          const prefix=incomingRows[0].sender+':\n';if(xml.startsWith(prefix))xml=xml.slice(prefix.length);
          const parsed=parseQuoteXml(xml,group);
          if(parsed?.quote.type===3&&parsed.quote.messageId===message.quote.messageId)message={...message,quote:parsed.quote};
        }
        const md5=quotedImageMd5(db,message);
        if(!md5)continue;
        const q=db.prepare(`SELECT local_id FROM "${tableFor(group)}" WHERE server_id=? LIMIT 2`);q.setReadBigInts(true);
        const rows=q.all(BigInt(message.quote.messageId));
        if(rows.length!==1)throw Error('Ambiguous referenced image');
        const localId=Number(rows[0].local_id);
        if(!Number.isSafeInteger(localId)||localId<1||localId>0xffffffff)throw Error('Invalid image local ID');
        matches.push({conversationId:group,senderId:message.quote.senderId,serverId:message.quote.messageId,localId,md5});
      }finally{db.close();}
    }finally{await rm(path,{force:true});}
  }
  if(matches.length!==1)throw Error('Quoted image identity not unique across shards');
  await mkdir('data/research/native',{recursive:true});
  await writeFile('data/research/native/quoted-image-identity-input.json',JSON.stringify(matches[0]));
  await writeFile('data/research/native/quoted-image-probe-message.json',JSON.stringify(message));
  console.log(JSON.stringify({prepared:true,quotedImages:1,identityVerifiedInDatabase:true,downloads:0,sends:0}));
}finally{key='';await rm(scratch,{recursive:true,force:true});}
