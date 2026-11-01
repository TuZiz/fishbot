// Only the explicitly authorized group and the exact synthetic acceptance marker.
// Never forwards history to AI or sends messages.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {join,resolve,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {snapshotDatabase} from '../dist/adapters/wechat/database/snapshot.js';
import {tableFor,readNewMessages,decodeText} from '../dist/adapters/wechat/database/messages.js';
const targets=JSON.parse(await readFile('data/wechat/native-targets.json','utf8'));
const kind=process.argv.includes('--private-test-friend')?'private':'group';
const marker=kind==='private'?'FishBot好友验收1031':'FishBot群聊验收1031';
const group=targets.filter(t=>t.kind===kind&&t.name==='备忘录');
if(group.length!==1)throw Error('Requires one explicitly authorized test conversation');
const keyPath=resolve('data/wechat/key.xml');
const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true});
const storage=(await readFile('data/wechat/storage-path.txt','utf8')).trim(),folder=await mkdtemp(join(tmpdir(),'fishbot-group-probe-'));
const matches=[],metadata=[],recentObservations=[],quoteStructures=[];
try{
  for(const file of (await readdir(join(storage,'message'))).filter(n=>/^message_\d+\.db$/.test(n))){
    const path=join(folder,file);await snapshotDatabase(join(storage,'message',file),path,stdout.trim());
    const db=new DatabaseSync(path,{readOnly:true});
    try{
      const table=tableFor(group[0].id);if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
      const account=basename(dirname(storage)),candidates=db.prepare('SELECT user_name FROM Name2Id').all().map(n=>String(n.user_name)).filter(n=>account===n||account.startsWith(n+'_'));
      if(candidates.length!==1)throw Error('Cannot identify self unambiguously');
      const max=Number(db.prepare(`SELECT COALESCE(MAX(local_id),0) AS n FROM "${table}"`).get().n);
      const recent=db.prepare(`SELECT m.local_type,m.create_time,n.user_name AS sender FROM "${table}" m LEFT JOIN Name2Id n ON n.rowid=m.real_sender_id ORDER BY m.local_id DESC LIMIT 3`).all();
      metadata.push({shard:file,hasTargetTable:true,recentTypes:recent.map(r=>String(r.local_type)),recentTimestamps:recent.map(r=>Number(r.create_time)*1000),sendersResolved:recent.map(r=>typeof r.sender==='string'),sendersAreSelf:recent.map(r=>r.sender===candidates[0])});
      const raw=db.prepare(`SELECT local_type,server_id,create_time,message_content FROM "${table}" ORDER BY local_id DESC LIMIT 10`);raw.setReadBigInts(true);
      for(const row of raw.all()){
        let content;try{content=decodeText(row.message_content);}catch{continue;}
        if(!content.includes('FishBot引用验收1031'))continue;
        const field=(xml,name)=>new RegExp('<'+name+'>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/'+name+'>').exec(xml);
        const value=(xml,name)=>{const found=field(xml,name);return found?.[1]??found?.[2]??null;};
        const reference=/<refermsg>([\s\S]*?)<\/refermsg>/.exec(content)?.[1]??'';
        quoteStructures.push({messageId:String(row.server_id),localType:String(row.local_type),timestamp:Number(row.create_time)*1000,
          tags:[...new Set([...content.matchAll(/<([a-zA-Z_][\w.-]*)(?:\s[^>]*)?>/g)].map(m=>m[1]))],appMessageType:value(content,'type'),
          quotedServerId:value(reference,'svrid'),quotedSenderMatchesSelf:value(reference,'fromusr')===candidates[0],
          hasTitleMarker:(value(content,'title')??'').includes('FishBot引用验收1031'),rawTextPrinted:false});
      }
      for(const message of readNewMessages(db,group[0].id,Math.max(0,max-10),candidates[0],file).messages){
        if(Date.now()-message.timestamp<10*60000)recentObservations.push({messageId:message.id,isSelf:message.isSelf,mentionedBot:message.mentionedBot,stableMemberFingerprint:createHash('sha256').update(message.senderId).digest('hex').slice(0,12),textFingerprint:createHash('sha256').update(message.text).digest('hex'),textLength:message.text.length,timestamp:message.timestamp,acceptanceMarkerMatched:message.text.replace(/\s/g,'').includes(marker)});
        if(!message.text.replace(/\s/g,'').includes(marker))continue;
        matches.push({messageId:message.id,stableMemberFingerprint:createHash('sha256').update(message.senderId).digest('hex').slice(0,12),isSelf:message.isSelf,mentionedBot:message.mentionedBot,replyToBot:message.replyToBot,timestamp:message.timestamp,source:message.source});
      }
    }finally{db.close();}
  }
}finally{await rm(folder,{recursive:true,force:true});}
const report={checkedAt:new Date().toISOString(),scope:`explicit authorized ${kind} 备忘录, last ten rows, exact synthetic marker; recent metadata only`,sourceReadOnly:true,forwardedToEngine:false,matches,metadata,recentObservations,quoteStructures,receiveVerified:matches.some(m=>m.isSelf===false),mentionVerified:matches.some(m=>m.isSelf===false&&m.mentionedBot),quotesVerified:false};
await writeFile(`data/research/native/${kind==='private'?'friend':'group'}-receive-snapshot-evidence.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
