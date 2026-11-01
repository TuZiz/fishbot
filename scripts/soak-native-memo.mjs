// Real wall-clock soak. Explicit test scope only; never generates synthetic inbound users.
import 'dotenv/config';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const minutes=Number(process.argv.find(v=>v.startsWith('--minutes='))?.slice(10)??30);
assert.ok(Number.isInteger(minutes)&&minutes>=1&&minutes<=60,'minutes must be 1..60');
assert.ok(process.argv.includes('--live-send'),'Explicit --live-send required');
const {conversationId}=JSON.parse(await readFile('data/research/native/test-target.json','utf8'));
const base=`http://127.0.0.1:${process.env.MEMO_TEST_PORT??8766}`,headers={'x-fishbot-token':process.env.INGEST_TOKEN};
const evidence={startedAt:new Date().toISOString(),durationRequestedMinutes:minutes,scope:'authorized private test friend 备忘录',testType:'native text transport soak; synthetic probes, not friend/group incoming',samples:[],probes:[],completed:false};
const path='data/research/native/native-soak-evidence.json';
let stopped=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopped=true;});
async function api(path,options={}){const response=await fetch(base+path,{headers,...options,signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);return response.json();}
const start=Date.now(),until=start+minutes*60000;let nextProbe=start,nextProgress=start;
try{
 while(!stopped){
  const elapsed=Date.now()-start,health=await api('/health');
  evidence.samples.push({elapsedMs:elapsed,connected:health.adapter.connected,context:health.adapter.context,inboxError:health.adapter.inboxError,lastInboxFailure:health.adapter.lastInboxFailure,uptime:health.uptime});
  if(Date.now()>=nextProbe){
   const id='native-soak-'+start+'-'+evidence.probes.length,text='FishBot 稳定性检查 '+(evidence.probes.length+1)+' '+new Date().toISOString();
   await api('/probe/send',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({message:{id,kind:'private',conversationId,senderId:'synthetic-soak',text:'Native transport probe',timestamp:Date.now(),source:'synthetic-transport-soak'},text})});
   // Another flush may already own the queue; queued=true is not a final result.
   const deadline=Date.now()+45000;let job;
   do{const replies=await api('/replies');job=replies.find(r=>r.incoming===id);if(job&&!['pending','sending'].includes(job.status))break;await new Promise(r=>setTimeout(r,500));}while(Date.now()<deadline&&!stopped);
   evidence.probes.push({probeId:id,elapsedMs:Date.now()-start,status:job?.status,result:job?.result?JSON.parse(job.result):null});
   nextProbe=Date.now()+5*60000;
  }
  evidence.elapsedMs=Date.now()-start;
  await writeFile(path,JSON.stringify(evidence,null,2));
  if(Date.now()>=nextProgress){console.log(JSON.stringify({elapsedMinutes:Math.floor(evidence.elapsedMs/60000),samples:evidence.samples.length,confirmed:evidence.probes.filter(p=>p.status==='sent').length,connected:health.adapter.connected}));nextProgress=Date.now()+60000;}
  if(Date.now()>=until)break;
  await new Promise(r=>setTimeout(r,Math.min(10000,until-Date.now())));
 }
 evidence.elapsedMs=Date.now()-start;evidence.completed=!stopped&&evidence.elapsedMs>=minutes*60000;
 evidence.passed=evidence.completed&&evidence.samples.every(s=>s.connected)&&evidence.probes.every(p=>p.status==='sent');
 assert.equal(evidence.passed,true,'Soak interrupted or a native probe was not confirmed');
}catch(error){evidence.failure=error instanceof Error?error.message:'Soak failed';process.exitCode=1;}
finally{evidence.elapsedMs=Date.now()-start;evidence.finishedAt=new Date().toISOString();await writeFile(path,JSON.stringify(evidence,null,2));console.log(JSON.stringify({completed:evidence.completed,passed:evidence.passed??false,elapsedMinutes:(evidence.elapsedMs??0)/60000,probes:evidence.probes.length}));}
