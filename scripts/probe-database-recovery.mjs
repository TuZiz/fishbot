// An independent read-only worker. Never stops the live bot's worker or sends a message.
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import {DatabaseObserver} from '../dist/adapters/wechat/database/observer.js';
const targets=JSON.parse(await readFile('data/wechat/native-targets.json','utf8'));
const launches=[];
const observer=new DatabaseObserver(snapshotRoot=>{
  const worker=new Worker(new URL('../dist/adapters/wechat/database/worker.js',import.meta.url),{execArgv:[],workerData:{snapshotRoot}});
  const entry={worker,snapshotRoot,resumedCursors:0};launches.push(entry);
  return {on:worker.on.bind(worker),once:worker.once.bind(worker),terminate:worker.terminate.bind(worker),postMessage(message){if(message.type==='watch')entry.resumedCursors=Object.keys(message.cursors??{}).length;worker.postMessage(message);}};
},500);
async function until(check,timeout=30000){const end=Date.now()+timeout;while(!await check()){assert.ok(Date.now()<end,'Read-only recovery condition timed out');await new Promise(r=>setTimeout(r,20));}}
const started=Date.now();let report;
try{
  observer.start();await until(()=>observer.sessions.length>0);
  for(const target of targets)assert.ok(observer.sessions.some(s=>s.id===target.id&&s.kind===target.kind&&s.name==='备忘录'),'Changed test target');
  observer.watch(targets.map(t=>t.id));
  await until(()=>targets.every(t=>observer.status.baselineIds.includes(t.id))&&!observer.status.error);
  const original=launches[0];
  await until(async()=>{const files=await readdir(original.snapshotRoot).catch(()=>[]);return files.some(f=>f.startsWith('scan-'));},10000);
  await original.worker.terminate();
  await until(()=>launches.length===2&&targets.every(t=>observer.status.baselineIds.includes(t.id))&&!observer.status.error);
  const removed=await access(original.snapshotRoot).then(()=>false,()=>true);
  report={checkedAt:new Date().toISOString(),readOnly:true,liveBotWorkerTouched:false,forcedOwnWorkerExit:true,terminatedDuringActiveSnapshot:true,
    relaunched:launches.length===2,resumedCursorCount:launches[1].resumedCursors,baselineTargetCount:observer.status.baselineIds.length,
    oldDecryptedSnapshotDirectoryRemoved:removed,recoveryAttempts:observer.status.recoveryAttempts,elapsedMs:Date.now()-started};
  assert.ok(report.relaunched&&report.resumedCursorCount>0&&removed);assert.equal(report.baselineTargetCount,targets.length);
}catch(error){report={checkedAt:new Date().toISOString(),failed:true,reason:error instanceof Error?error.message:'Read-only recovery failed'};process.exitCode=1;}
finally{await observer.close();await writeFile('data/research/native/database-recovery-evidence.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
