// Read-only evidence collection from the dedicated runner and a separate DB observer.
import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const {conversationId}=JSON.parse(await readFile('data/research/native/test-target.json','utf8'));
const headers={'x-fishbot-token':process.env.INGEST_TOKEN};
const base=`http://127.0.0.1:${process.env.MEMO_TEST_PORT??8766}`;
async function get(url){const response=await fetch(url,{headers,signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error(`Evidence endpoint HTTP ${response.status}`);return response.json();}
const [health,replies,usage,events]=await Promise.all([
  get(base+'/health'),get(base+'/replies'),get(base+'/api/status'),
  get(`http://127.0.0.1:${process.env.PORT??8765}/api/wechat/events`),
]);
const sent=replies.filter(r=>r.target===conversationId&&r.status==='sent');
const confirmations=sent.map(r=>{
  const result=JSON.parse(r.result),echo=events.find(e=>e.conversationId===conversationId&&e.kind==='private'&&e.isSelf&&e.text===r.text&&e.id===result.messageId);
  return {queueId:r.id,status:r.status,messageId:result.messageId,targetMatched:!!echo,textMatched:!!echo,independentDatabaseEcho:!!echo,timestamp:echo?.timestamp};
});
// Wait across several observer scans to detect an unintended reply/AI loop.
const initialIds=replies.map(r=>r.id).sort((a,b)=>a-b);
await new Promise(r=>setTimeout(r,12000));
const [later,laterUsage]=await Promise.all([get(base+'/replies'),get(base+'/api/status')]);
const stable=JSON.stringify(initialIds)===JSON.stringify(later.map(r=>r.id).sort((a,b)=>a-b))&&usage.totals.calls===laterUsage.totals.calls;
const report={date:new Date().toISOString(),clientVersion:'4.2.0.12',backend:health.adapter.backend,testScope:'self memo only',dryRun:health.dryRun,confirmations,usage:usage.totals,outbox:usage.outbox,errorCount:usage.errors.length,quietWindowSeconds:12,noEchoLoopObserved:stable,remoteDeviceDeliveryVerified:false,friendsVerified:false,groupsVerified:false,imagesVerified:false};
await writeFile('data/research/native/native-memo-ai-evidence.json',JSON.stringify(report,null,2));
assert.equal(health.adapter.backend,'native-memo-experimental');assert.equal(health.dryRun,false);
assert.ok(confirmations.length>=2&&confirmations.every(c=>c.independentDatabaseEcho&&/^[1-9]\d+$/.test(c.messageId)),'Need two independent database-confirmed sends');
assert.equal(stable,true,'Unexpected new work during quiet window');assert.equal(usage.errors.length,0);
console.log(JSON.stringify(report));
