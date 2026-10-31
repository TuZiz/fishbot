import sys,os,json,time
sys.path.insert(0,os.path.abspath('../.tools/hook-research'));import frida
if '--allow-experimental-thread-trace' not in sys.argv:raise SystemExit('Experimental thread tracing disabled after unexplained client exit; inspect research notes first')
meta=json.load(open('data/research/native/process-metadata.json',encoding='utf-8-sig'))
agent=r'''
const module=Process.getModuleByName('Weixin.dll');
const result={selfCheck:0,enterEvents:0,thread:null,calls:{}};
const kernel=Process.getModuleByName('kernel32.dll');
const pidAddress=kernel.getExportByName('GetCurrentProcessId');
const sanity=Interceptor.attach(pidAddress,{onEnter(){result.selfCheck++;}});
Interceptor.flush();const pidFunction=new NativeFunction(pidAddress,'uint32',[]);const actualPid=pidFunction();sanity.detach();
if(actualPid!==Process.id||result.selfCheck<1)throw Error('Instrumentation self-check failed');
let armed=true,tracked=null;
const dispatch=Process.getModuleByName('user32.dll').getExportByName('DispatchMessageW');
const listener=Interceptor.attach(dispatch,{onEnter(args){
 if(!armed)return;
 const message=args[0].add(8).readU32();
 if(message!==0x100||args[0].add(16).readU64().toString()!=='13')return;
 armed=false;result.enterEvents++;tracked=this.threadId;result.thread=tracked;
 Stalker.follow(tracked,{events:{call:true},onCallSummary(summary){for(const [address,count] of Object.entries(summary)){const p=ptr(address);if(p.compare(module.base)>=0&&p.compare(module.base.add(module.size))<0){const rva=p.sub(module.base).toString();if(Object.keys(result.calls).length<3000||rva in result.calls)result.calls[rva]=(result.calls[rva]||0)+count;}}}});
 setTimeout(()=>{if(tracked!==null){Stalker.unfollow(tracked);Stalker.flush();tracked=null;send({event:'trace-complete',callTargets:Object.keys(result.calls).length});}},1200);
}});
rpc.exports={snapshot(){return result;},dispose(){listener.detach();if(tracked!==null){Stalker.unfollow(tracked);Stalker.flush();tracked=null;}}};
send({event:'trace-ready',pid:actualPid,selfCheck:result.selfCheck,readsText:false,canSend:false});
'''
session=frida.attach(meta['pid']);script=session.create_script(agent)
script.on('message',lambda m,d:print(json.dumps(m),flush=True))
try:
 script.load()
 for _ in range(40):
  time.sleep(2);result=script.exports_sync.snapshot()
  if result['enterEvents'] and result['calls']:time.sleep(3);break
 result=script.exports_sync.snapshot()
 with open('data/research/native/ui-send-call-trace.json','w') as f:json.dump(result,f,indent=2)
 print(json.dumps({'event':'trace-result','selfCheck':result['selfCheck'],'enterEvents':result['enterEvents'],'callTargets':len(result['calls'])}),flush=True)
finally:
 try:script.exports_sync.dispose();script.unload()
 finally:session.detach()

