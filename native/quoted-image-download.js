// Coordinates one quoted-photo task in the existing native host.
(() => {

let active = null, last = null, stopped = false;
function validIdentity(v) {
  return v && typeof v.id === 'string' && /^[a-f0-9-]{36}$/.test(v.id) &&
    typeof v.conversationId === 'string' && /^[A-Za-z0-9_@.-]{1,256}$/.test(v.conversationId) &&
    typeof v.senderId === 'string' && /^[A-Za-z0-9_@.-]{1,256}$/.test(v.senderId) &&
    typeof v.serverId === 'string' && /^[1-9][0-9]{0,18}$/.test(v.serverId) &&
    uint64(v.serverId).compare(uint64('9223372036854775807')) <= 0 &&
    Number.isInteger(v.localId) && v.localId > 0 && v.localId <= 0xffffffff &&
    typeof v.md5 === 'string' && /^[a-f0-9]{32}$/.test(v.md5);
}
function finish(state, error) {
  const a = active;
  if (!a) return;
  a.job.dispose();
  last = {id:a.id,state,kind:a.kind,...(error?{error}:{}),released:true};
  active = null;
}
function tick() {
  const a = active;
  if (!a) return;
  try {
    const s = a.job.status();
    if (s.failure) {a.cancel=true; a.error='native-task-failed';}
    if (Date.now() >= a.deadline) {a.cancel=true;a.error='download-timeout';}
    if (!s.completed) return; // Never free an object still used by our hook.
    if (s.phase === 'cancel-complete') return finish('cancelled',a.error);
    const d = a.job.downloadStatus();
    if (a.cancel) {
      if (d.started && !d.complete) {a.job.cancelDownload();return;}
      return finish('cancelled',a.error);
    }
    if (!a.described) {
      if (!s.query?.complete) return;
      if (!s.query.identityMatched || !s.query.md5Matched) return finish('failed','reference-identity-unavailable');
      a.described=true;
      a.job.describe();
      return;
    }
    if (s.descriptor?.failed || !s.descriptor?.taskIdentityMatched) {
      a.cancel=true; a.error='download-construction-failed';return;
    }
    a.kind = s.descriptor.kind;
    if (d.complete) return finish(d.resultCode === 0?'complete':'failed',d.resultCode === 0?undefined:'download-failed');
  } catch (_) {
    // Keep ownership until the next tick can cancel in the native context.
    a.cancel=true;a.error='download-state-unavailable';
  }
}
const timer=setInterval(tick,100);
rpc.exports.startquoteddownload=function(expected) {
  if (stopped) return {id:expected?.id,state:'failed',error:'downloader-stopped'};
  if (!validIdentity(expected)) throw Error('Invalid quoted image identity');
  if (active) return {id:expected.id,state:'busy'};
  const job=createQuotedImageDownloadTask(expected);
  active={id:expected.id,job,deadline:Date.now()+40000,described:false,cancel:false};
  try {job.start();} catch (_) {active=null;last={id:expected.id,state:'failed',error:'download-start-failed',released:true};return last;}
  return {id:expected.id,state:'pending'};
};
rpc.exports.quoteddownloadstatus=function(id) {
  tick();
  if (active?.id===id) return {id,state:'pending',kind:active.kind};
  if (last?.id===id) return last;
  return {id,state:'missing'};
};
rpc.exports.cancelquoteddownload=function(id) {
  if (active?.id===id) {active.cancel=true;tick();}
  return rpc.exports.quoteddownloadstatus(id);
};
const previousDispose=rpc.exports.dispose;
rpc.exports.dispose=function() {
  stopped=true;
  if (active) {active.cancel=true;tick();}
  if (active) return {disposed:false,downloadPending:true};
  clearInterval(timer);
  previousDispose();
  return {disposed:true};
};
})();
