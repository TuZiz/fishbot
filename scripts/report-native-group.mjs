// Inspect only explicitly authorized test conversations. No message text or raw member IDs printed.
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const targets=JSON.parse(await readFile('data/wechat/native-targets.json','utf8'));
const group=targets.find(t=>t.kind==='group'),friend=targets.find(t=>t.kind==='private');
if(!group||!friend)throw Error('Requires both explicitly authorized test conversations');
const scope=JSON.stringify(['group',group.id]),fingerprint=id=>createHash('sha256').update(id).digest('hex').slice(0,12);
const db=new DatabaseSync('data/native-memo-test.sqlite',{readOnly:true});
const snapshot=await readFile('data/research/native/group-receive-snapshot-evidence.json','utf8').then(JSON.parse,()=>({recentObservations:[]}));
try{
  const records=db.prepare('SELECT body FROM messages WHERE scope=? ORDER BY rowid DESC LIMIT 8').all(scope).map(row=>{
    const m=JSON.parse(row.body),jobs=db.prepare('SELECT status,attempts,result,text FROM outbox WHERE scope=? AND incoming=?').all(scope,m.id);
    return {messageId:m.id,isSelf:m.isSelf,mentionedBot:m.mentionedBot,replyToBot:m.replyToBot,source:m.source,timestamp:m.timestamp,
      stableMemberFingerprint:fingerprint(m.senderId),senderMatchesTestFriend:m.senderId===friend.id,
      outbox:jobs.map(j=>{const result=j.result?JSON.parse(j.result):null;return {status:j.status,attempts:j.attempts,result,independentDatabaseEcho:snapshot.recentObservations.some(e=>e.isSelf&&e.messageId===result?.messageId&&e.textFingerprint===createHash('sha256').update(j.text).digest('hex'))};})};
  });
  const report={checkedAt:new Date().toISOString(),scope:'authorized ordinary group 备忘录',records,
    realGroupReceiveVerified:records.some(r=>r.source==='wechat-database'&&r.isSelf===false),
    realMentionVerified:records.some(r=>r.source==='wechat-database'&&r.isSelf===false&&r.mentionedBot===true),
    nativeAutomaticReplyConfirmed:records.some(r=>r.source==='wechat-database'&&r.isSelf===false&&r.outbox.some(j=>j.status==='sent')),
    independentAutomaticReplyConfirmations:records.filter(r=>r.source==='wechat-database'&&r.isSelf===false&&r.outbox.some(j=>j.status==='sent'&&j.independentDatabaseEcho)).length,
    quotedIncomingPresent:records.some(r=>r.source==='wechat-database'&&r.replyToBot),remoteDeviceDeliveryVerified:false};
  await writeFile('data/research/native/group-runtime-evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{db.close();}
