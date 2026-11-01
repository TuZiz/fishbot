// One explicitly authorized private transport probe. Never synthesizes friend input.
import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
assert.ok(process.argv.includes('--live-send'),'Requires --live-send');
const targets=JSON.parse(await readFile('data/wechat/native-targets.json','utf8'));
const friends=targets.filter(t=>t.kind==='private'&&t.name==='备忘录');
assert.equal(friends.length,1,'Requires the unique authorized test friend');
const target=friends[0],base=`http://127.0.0.1:${process.env.MEMO_TEST_PORT??8766}`;
const headers={'x-fishbot-token':process.env.INGEST_TOKEN};
async function api(path,options={}){
 const response=await fetch(base+path,{headers,signal:AbortSignal.timeout(20000),...options});
 assert.equal(response.status,200);return response.json();
}
const report={startedAt:new Date().toISOString(),testType:'synthetic native text transport; not real friend incoming',passed:false,remoteDeviceDeliveryVerified:false};
try{
 const health=await api('/health');
 assert.equal(health.adapter.backend,'native-memo-experimental');
 assert.ok(health.adapter.connected&&!health.dryRun&&!health.paused);
 assert.equal(health.adapter.context.readyTargetCount,targets.length);
 const id='native-text-probe-'+Date.now(),text='FishBot 原生回执检查 '+new Date().toISOString();
 report.probeId=id;
 await api('/probe/send',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({message:{id,kind:'private',conversationId:target.id,senderId:'synthetic-transport-probe',text:'Native transport probe',timestamp:Date.now(),source:'synthetic-transport-probe'},text})});
 let job;const deadline=Date.now()+45000;
 do{
  job=(await api('/replies')).find(j=>j.incoming===id);
  if(job&&!['pending','sending'].includes(job.status))break;
  await new Promise(r=>setTimeout(r,500));
 }while(Date.now()<deadline);
 report.status=job?.status;report.attempts=job?.attempts;report.result=job?.result?JSON.parse(job.result):null;
 // An unknown outcome is never resent. A later independent echo is evidence,
 // not permission to rewrite the persisted outcome or repeat the native call.
 const until=Date.now()+15000;
 do{
  const response=await fetch(`http://127.0.0.1:${process.env.PORT??8765}/api/wechat/events`,{headers,signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,200,'Independent observer required');
  const events=await response.json();
  const echo=events.find(e=>e.kind==='private'&&e.conversationId===target.id&&e.isSelf&&e.text===text&&/^[1-9]\d+$/.test(e.id));
  report.independentDatabaseEcho=!!echo;report.independentMessageId=echo?.id;
  if(echo)break;
  await new Promise(r=>setTimeout(r,500));
 }while(Date.now()<until);
 report.passed=job?.status==='sent'&&report.independentDatabaseEcho===true&&report.result?.messageId===report.independentMessageId;
 assert.ok(report.passed,'Native transport was not confirmed by both receipt paths');
}catch(error){report.failure=error instanceof Error?error.message:'Native text probe failed';process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile('data/research/native/native-text-probe-evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
