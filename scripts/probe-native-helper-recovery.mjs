// Explicit fault injection into this FishBot runner's own helper only; never terminates WeChat.
import 'dotenv/config';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

assert.ok(process.argv.includes('--terminate-owned-helper'),'Requires --terminate-owned-helper');
const parentPid=Number(process.argv.find(v=>v.startsWith('--parent-pid='))?.split('=')[1]);
assert.ok(Number.isSafeInteger(parentPid)&&parentPid>0,'Explicit runner PID required');
const port=Number(process.env.MEMO_TEST_PORT??8766);
assert.ok(Number.isSafeInteger(port)&&port>0&&port<=65535);
const base=`http://127.0.0.1:${port}`,headers={'x-fishbot-token':process.env.INGEST_TOKEN};
const hostPath=resolve('native/memo-host.py').replaceAll("'","''");
const ps=async script=>{
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-Command',`$ErrorActionPreference='Stop';${script}`],{windowsHide:true});
  return JSON.parse(stdout);
};
const identify=()=>ps(`
$runner=Get-CimInstance Win32_Process -Filter 'ProcessId=${parentPid}';
if(!$runner -or $runner.Name -ne 'node.exe' -or $runner.CommandLine -notmatch 'run-native-memo\\.mjs'){throw 'Runner identity mismatch'}
$listener=@(Get-NetTCPConnection -LocalPort ${port} -State Listen | Where-Object OwningProcess -eq ${parentPid});
if($listener.Count -ne 1){throw 'Endpoint owner mismatch'}
$helpers=@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${parentPid}' | Where-Object {$_.Name -eq 'python.exe' -and $_.CommandLine.Contains('${hostPath}')});
if($helpers.Count -ne 1){throw 'Expected one owned memo-host helper'}
$wechat=@(Get-CimInstance Win32_Process -Filter "Name='Weixin.exe'" | Sort-Object ProcessId | ForEach-Object {[int]$_.ProcessId});
@{helperPid=[int]$helpers[0].ProcessId;created=$helpers[0].CreationDate.ToUniversalTime().ToString('o');wechatPids=$wechat}|ConvertTo-Json -Compress`);
async function api(path){const response=await fetch(base+path,{headers,signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);return response.json();}
const samples=[];
const started=Date.now();
let report={startedAt:new Date().toISOString(),testType:'forced owned native helper exit; no message sent',parentPid,samples,passed:false};
try{
  const initial=await api('/health');
  assert.equal(initial.adapter.backend,'native-memo-experimental');
  assert.equal(initial.adapter.context.readyTargetCount,2,'Both authorized targets must be ready');
  assert.equal(initial.adapter.context.busy,false);
  const jobs=await api('/replies');
  assert.ok(!jobs.some(j=>['pending','sending'].includes(j.status)),'Wait for active deliveries');
  const before=await identify();report.before=before;
  // Recheck identity and creation time in the same PowerShell invocation as termination.
  await ps(`$helper=Get-CimInstance Win32_Process -Filter 'ProcessId=${before.helperPid}';
if(!$helper -or $helper.ParentProcessId -ne ${parentPid} -or $helper.Name -ne 'python.exe' -or !$helper.CommandLine.Contains('${hostPath}') -or $helper.CreationDate.ToUniversalTime().ToString('o') -ne '${before.created}'){throw 'Helper identity changed; refused'}
Stop-Process -Id $helper.ProcessId -ErrorAction Stop;@{terminatedOwnedHelper=$true}|ConvertTo-Json -Compress`);
  report.forcedOwnHelperExit=true;
  const deadline=Date.now()+60000;
  let after;
  while(Date.now()<deadline){
    const health=await api('/health');
    samples.push({elapsedMs:Date.now()-started,connected:health.adapter.connected,context:health.adapter.context,inboxError:health.adapter.inboxError});
    if(health.adapter.connected&&health.adapter.context.readyTargetCount===2){
      // The cached pre-crash health can stay ready until the next heartbeat.
      try{after=await identify();}catch{after=undefined;}
      if(after&&after.helperPid!==before.helperPid){
        const confirmed=await api('/health');
        if(confirmed.adapter.connected&&confirmed.adapter.context.readyTargetCount===2&&!confirmed.adapter.context.busy){
          report.recoveredHealth={checkedAt:new Date().toISOString(),connected:confirmed.adapter.connected,context:confirmed.adapter.context,inboxError:confirmed.adapter.inboxError};
          break;
        }
        after=undefined;
      }
    }
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(after&&after.helperPid!==before.helperPid,'Helper did not recover within 60 seconds');
  assert.deepEqual(after.wechatPids,before.wechatPids,'WeChat process set changed during recovery');
  report.after=after;report.passed=true;
}catch(error){report.failure=error instanceof Error?error.message:'Helper recovery failed';process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();report.elapsedMs=Date.now()-started;
  await writeFile('data/research/native/native-helper-recovery-evidence.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
