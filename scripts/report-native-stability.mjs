// Read-only reconciliation: a second observer is independent of the sender's receipt path.
import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const root='data/research/native/';
const soak=JSON.parse(await readFile(root+'native-soak-evidence.json','utf8'));
const {conversationId}=JSON.parse(await readFile(root+'test-target.json','utf8'));
const response=await fetch(`http://127.0.0.1:${process.env.PORT??8765}/api/wechat/events`,{
  headers:{'x-fishbot-token':process.env.INGEST_TOKEN},signal:AbortSignal.timeout(8000),
});
assert.equal(response.status,200,'Independent observer must be running');
const events=await response.json();
const queued=await fetch(`http://127.0.0.1:${process.env.MEMO_TEST_PORT??8766}/replies`,{headers:{'x-fishbot-token':process.env.INGEST_TOKEN},signal:AbortSignal.timeout(8000)});
assert.equal(queued.status,200);
const rows=await queued.json();
const started=Date.parse(soak.startedAt);
const matchingRows=rows.filter(row=>{
  const match=/^native-soak-(\d+)-(\d+)$/.exec(row.incoming);
  return match&&row.target===conversationId&&Number(match[1])>=started&&Number(match[1])-started<1000;
});
const runs=new Set(matchingRows.map(row=>row.incoming.split('-').slice(0,-1).join('-')));
assert.equal(runs.size,1,'Ambiguous or missing soak run; do not guess probe IDs');
const confirmations=soak.probes.map((probe,i)=>{
  const row=matchingRows.find(row=>probe.probeId?row.incoming===probe.probeId:Number(row.incoming.split('-').at(-1))===i);
  const result=row?.result?JSON.parse(row.result):null;
  return {elapsedMs:probe.elapsedMs,observedStatus:probe.status,finalStatus:row?.status,messageId:result?.messageId,
    independentlyConfirmed:events.some(e=>e.kind==='private'&&e.conversationId===conversationId&&e.isSelf&&e.id===result?.messageId&&e.text===row?.text)};
});
const gaps=soak.samples.slice(1).map((sample,i)=>sample.elapsedMs-soak.samples[i].elapsedMs);
const maximumSampleGapMs=Math.max(0,...gaps);
const report={
  recordedAt:new Date().toISOString(),startedAt:soak.startedAt,finishedAt:soak.finishedAt,
  requestedMinutes:soak.durationRequestedMinutes,elapsedMs:soak.elapsedMs,completed:soak.completed,
  rawSoakPassed:soak.passed===true,sampleCount:soak.samples.length,unhealthySamples:soak.samples.filter(s=>!s.connected),maximumSampleGapMs,confirmations,
  independentTransportPass:soak.completed===true&&confirmations.length>=Math.ceil(soak.durationRequestedMinutes/5)&&confirmations.every(p=>p.finalStatus==='sent'&&p.independentlyConfirmed),
  uninterruptedHealthPass:soak.samples.every(s=>s.connected)&&maximumSampleGapMs<=30000,
  scope:'authorized private test friend 备忘录; periodic synthetic native text probes',
  friendIncomingVerified:false,groupIncomingVerified:false,remoteDeviceDeliveryVerified:false,
};
await writeFile(root+'native-stability-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
assert.equal(report.independentTransportPass&&report.uninterruptedHealthPass,true,'Full stability acceptance failed: report transport receipts and health interruptions separately');
