// Read-only, real incoming messages only. Prefix self-tests are explicitly excluded.
import 'dotenv/config';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
const targets=JSON.parse(await readFile('data/wechat/native-targets.json','utf8'));
const friend=targets.find(t=>t.kind==='private');if(!friend||friend.selfTest)throw Error('Requires explicitly authorized friend-incoming mode');
const startup=JSON.parse(await readFile('data/research/native/resumed-startup-evidence.json','utf8'));
const headers={'x-fishbot-token':process.env.INGEST_TOKEN};
const response=await fetch(`http://127.0.0.1:${process.env.PORT??8765}/api/wechat/events`,{headers,signal:AbortSignal.timeout(5000)});
const events=response.ok?await response.json():[];
const db=new DatabaseSync('data/native-memo-test.sqlite',{readOnly:true}),scope=JSON.stringify(['private',friend.id]);
try{
  const records=db.prepare('SELECT body FROM messages WHERE scope=? ORDER BY rowid DESC LIMIT 10').all(scope).map(row=>JSON.parse(row.body))
    .filter(m=>m.source==='wechat-database'&&m.isSelf===false&&m.senderId===friend.id&&m.timestamp>=Date.parse(startup.checkedAt))
    .map(m=>({messageId:m.id,timestamp:m.timestamp,source:m.source,isSelf:m.isSelf,senderMatchesFriend:true,
      acceptanceMarkerMatched:m.text.includes('FishBot好友验收1031'),
      outbox:db.prepare('SELECT status,result,text,attempts FROM outbox WHERE scope=? AND incoming=?').all(scope,m.id).map(row=>{
        const result=row.result?JSON.parse(row.result):null;
        return {status:row.status,attempts:row.attempts,result,
          independentDatabaseEcho:events.some(e=>e.kind==='private'&&e.conversationId===friend.id&&e.isSelf&&e.id===result?.messageId&&e.text===row.text)};
      })}));
  const report={checkedAt:new Date().toISOString(),scope:'explicit test friend 备忘录',prefixSelfTestsExcluded:true,records,
    realFriendIncomingVerified:records.length>0,
    nativeAutomaticReplyConfirmed:records.some(r=>r.outbox.some(o=>o.status==='sent')),
    independentlyConfirmed:records.some(r=>r.outbox.some(o=>o.status==='sent'&&o.independentDatabaseEcho)),remoteDeviceDeliveryVerified:false};
  await writeFile('data/research/native/friend-runtime-evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{db.close();}
