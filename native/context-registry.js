// Discover the exact verified QObject vtable; never extract arbitrary strings.
function createContextRegistry(c,m,listeners){
 const candidates=new Map();let stopped=false,discovering=true,scannedBytes=0,scanErrors=0,destroyed=0;
 const vtable=m.base.add(0x9881d28),pattern=vtable.toMatchPattern();
 const getThread=new NativeFunction(Process.getModuleByName('user32.dll').getExportByName('GetWindowThreadProcessId'),'uint',['pointer','pointer']);
 const pid=Memory.alloc(4),uiThread=getThread(ptr(c.windowHandle),pid);
 if(!uiThread||pid.readU32()!==Process.id)throw Error('Verified client window unavailable');
 function targetOf(p){try{
  if(!p.readPointer().equals(vtable)||!p.add(8).readPointer().add(8).readPointer().equals(p))return null;
  const data=p.add(0x10).readPointer();if(data.isNull()||data.add(0x2a0).readPointer().isNull())return null;
  return c.targets.find(t=>matches(data.add(0x260),t.bytes))?.id??null;
 }catch{return null;}}
 function remember(p){try{
  // A newly constructed controller may receive its conversation binding later.
  // Track only its verified QObject identity here; forTarget still validates the
  // live recipient and send service every time, including immediately before submit.
  if(p.readPointer().equals(vtable)&&p.add(8).readPointer().add(8).readPointer().equals(p))candidates.set(p.toString(),p);
 }catch{}}
 listeners.push(Interceptor.attach(m.base.add(0x3e86300),{onEnter(args){this.object=args[0];},onLeave(){if(!stopped&&this.object)remember(this.object);}}));
 // Verified deleting destructor: invalidate before QObject teardown/free.
 listeners.push(Interceptor.attach(m.base.add(0x3e8edb0),{onEnter(args){if(candidates.delete(args[0].toString()))destroyed++;}}));
 listeners.push(Interceptor.attach(m.base.add(0x3e863e0),{onEnter(args){if(!stopped&&Process.getCurrentThreadId()===uiThread)remember(args[0]);}}));
 async function discover(){
  const ranges=Process.enumerateRanges({protection:'rw-',coalesce:false}).filter(r=>!r.file);
  for(const range of ranges){
   if(stopped||scannedBytes>=512*1024*1024)break;
   const size=Math.min(range.size,512*1024*1024-scannedBytes);scannedBytes+=size;
   await new Promise(resolve=>Memory.scan(range.base,size,pattern,{onMatch(address){if(!stopped)remember(address);},onError(){scanErrors++;resolve();},onComplete:resolve}));
  }
  discovering=false;
 }
 void discover().catch(()=>{discovering=false;scanErrors++;});
 return {
  thread:uiThread,
  forTarget(id){const found=[...candidates.values()].filter(p=>targetOf(p)===id);return found.length===1?found[0]:null;},
  status(){const targets=c.targets.map(t=>({id:t.id,ready:!!this.forTarget(t.id)}));return {ready:targets.some(t=>t.ready),readyTargetCount:targets.filter(t=>t.ready).length,busy:false,expiresAt:0,state:discovering?'discovering':targets.some(t=>t.ready)?'ready':'context-unavailable',scannedBytes,scanErrors,destroyed};},
  dispose(){stopped=true;candidates.clear();}
 };
}
