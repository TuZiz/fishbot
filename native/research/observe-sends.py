"""Authorized observation only: counts selected native call sites; cannot send messages."""
import sys,os,json,hashlib,time
sys.path.insert(0,os.path.abspath('../.tools/hook-research'))
import frida,pefile
meta=json.load(open('data/research/native/process-metadata.json',encoding='utf-8-sig'))
if not isinstance(meta,dict):raise RuntimeError('Expected one Weixin.dll process')
if meta['version']!='4.2.0.12':raise RuntimeError('Unsupported client version')
report=json.load(open('data/research/native/weixin-static-report.json'))
with open(meta['module'],'rb') as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
if digest!=report['sha256']:raise RuntimeError('Module fingerprint changed')
pe=pefile.PE(meta['module'],fast_load=True)
# Anchors only identify candidates. No signature/ABI is assumed and no NativeFunction is created.
candidates=json.load(open('data/research/native/active-candidates.json'))
for c in candidates:c['label']+=':'+hex(c['rva'])
allowed={item['rva'] for item in json.load(open('data/research/native/active-candidates.json'))}
for item in candidates:
 if item['rva'] not in allowed:raise RuntimeError('Candidate missing offline evidence')
 item['prologue']=pe.get_data(item['rva'],16).hex()
agent='''
const config=CONFIG;
const module=Process.getModuleByName('Weixin.dll');
if(Process.arch!=='x64'||!module.path.toLowerCase().includes('4.2.0.12'))throw Error('Module identity mismatch');
const listeners=[],stats={};
for(const c of config){
 const address=module.base.add(c.rva),bytes=new Uint8Array(address.readByteArray(16));
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 if(hex!==c.prologue)throw Error('Runtime instruction mismatch');
}
for(const c of config){
 stats[c.label]={hits:0,callers:{}};
 listeners.push(Interceptor.attach(module.base.add(c.rva),{onEnter(){
  const s=stats[c.label];s.hits++;
  const caller=this.returnAddress.sub(module.base).toString();
  if(Object.keys(s.callers).length<20||caller in s.callers)s.callers[caller]=(s.callers[caller]||0)+1;
 }}));
}
rpc.exports={snapshot(){return stats;},dispose(){for(const l of listeners)l.detach();}};
send({event:'observer-ready',hooks:config.length,readsChatText:false,canSend:false});
'''.replace('CONFIG',json.dumps(candidates))
result={'sha256':digest,'version':meta['version'],'observationOnly':True,'canSend':False}
session=None;script=None
try:
 session=frida.attach(meta['pid'])
 script=session.create_script(agent)
 script.on('message',lambda message,data:print(json.dumps(message,ensure_ascii=False),flush=True))
 script.load()
 positive=0
 for n in range(60):
  time.sleep(3)
  stats=script.exports_sync.snapshot()
  if any(s['hits'] for k,s in stats.items() if k.startswith('ui-send:') or k.startswith('input-send:')):
   positive+=1;print(json.dumps({'event':'counts','stats':stats}),flush=True)
   if positive>=3:break
 result['counts']=script.exports_sync.snapshot()
finally:
 if script:
  try:script.exports_sync.dispose();script.unload()
  except Exception as error:result['cleanupError']=type(error).__name__
 if session:
  try:session.detach()
  except Exception as error:result['detachError']=type(error).__name__
 with open('data/research/native/runtime-observation.json','w',encoding='utf-8') as f:json.dump(result,f,indent=2)
 print(json.dumps({'event':'observer-stopped','result':result}),flush=True)


