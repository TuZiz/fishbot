// Experimental, fingerprint-bound memo backend. No keyboard, OCR or desktop control.
const c=CONFIG,m=Process.getModuleByName('Weixin.dll'),listeners=[];
if(Process.arch!=='x64')throw Error('Unsupported architecture');
let pending=null,busy=false;
function matches(p,bytes){
 if(p.add(16).readU64().compare(bytes.length)!==0)return false;
 const capacity=p.add(24).readU64();if(capacity.compare(bytes.length)<0||capacity.compare(32768)>0)return false;
 const data=capacity.compare(16)<0?p:p.readPointer(),value=new Uint8Array(data.readByteArray(bytes.length));
 return bytes.every((v,i)=>value[i]===v);
}
function matchesWide(p,text){
 const length=p.add(16).readU64(),capacity=p.add(24).readU64();if(length.compare(text.length)!==0||capacity.compare(text.length)<0||capacity.compare(32768)>0)return false;
 const data=capacity.compare(8)<0?p:p.readPointer();return data.readUtf16String(text.length)===text;
}
function objectIn(list){const p=list.readPointer(),begin=p.add(8).readS32(),end=p.add(12).readS32();if(begin<0||end-begin!==1||end>64)throw Error('Expected one message');return p.add(16+begin*8).readPointer().readPointer();}
for(const s of c.sites){const bytes=new Uint8Array(m.base.add(s.rva).readByteArray(16));if(Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')!==s.prologue)throw Error('Runtime code mismatch');}
function fn(rva,ret,args){return new NativeFunction(m.base.add(rva),ret,args);}
const qFromUtf8=fn(0x27f80,'pointer',['pointer','pointer','int']),qAssign=fn(0x1adc0,'pointer',['pointer','pointer']);
const makeText=fn(0x3ec5f70,'pointer',['pointer','pointer','pointer']),append=fn(0x1c48c00,'void',['pointer','pointer','pointer','pointer']);
const submit=fn(0x3e863e0,'void',['pointer','uint','pointer']),releasePair=fn(0x76ae350,'void',['pointer']);
const imageFactory=c.imageFactory?fn(c.imageFactory.rva,'pointer',['pointer','pointer','pointer']):null;
const contexts=createContextRegistry(c,m,listeners);
function execute(request){
 const result={attempted:false,nativeReturned:false};
 const q=Memory.alloc(8),empty=Memory.alloc(8),pair=Memory.alloc(64),list=Memory.alloc(8),imageOptions=Memory.alloc(32);
 imageOptions.add(24).writeU64(15);
 q.writePointer(m.base.add(0xb40bb50));empty.writePointer(m.base.add(0xb40bb50));pair.writePointer(ptr(0));pair.add(8).writePointer(ptr(0));list.writePointer(m.base.add(0xb40bbc8));
 let built=false,transferred=false;
 try{
  const controller=contexts.forTarget(request.target);if(!controller&&!request.probeOnly)throw Error('Verified recipient context unavailable');
  qFromUtf8(q,Memory.allocUtf8String(request.imagePath??request.text),request.bytes.length);
  // Exact-version decompilation proves the first factory parameter is unused.
  if(request.imagePath)imageFactory(pair,q,imageOptions);else makeText(ptr(0),pair,q);
  built=true;const object=pair.readPointer();if(object.isNull())throw Error('Native factory returned no content');
  if(request.imagePath){
   if(request.probeOnly)result.layout={vtable:object.readPointer().sub(m.base).toString(),type:object.add(0x118).readU32(),widePathMatches:matchesWide(object.add(0x120),request.imagePath),fileSize:object.add(0x1c8).readU64().toString()};
   if(!c.imageFactory||object.readPointer().sub(m.base).toUInt32()!==c.imageFactory.vtable||object.add(0x118).readU32()!==3||!matchesWide(object.add(0x120),request.imagePath)||object.add(0x1c8).readU64().compare(request.fileSize)!==0)throw Error('Constructed image mismatch');
   result.constructed=true;
   if(request.probeOnly)return result;
   if(!c.imageFactory.sendEnabled)throw Error('Image submission not enabled');
  }else if(object.readPointer().sub(m.base).toUInt32()!==0x912d238||object.add(0x118).readU32()!==1||!matches(object.add(0x758),request.bytes))throw Error('Constructed message mismatch');
  append(list,pair,ptr(0),ptr(0));if(!objectIn(list).equals(object)||!contexts.forTarget(request.target)?.equals(controller))throw Error('Queue or recipient mismatch');
  // Mode 1 was observed in the current client's real text submission.
  result.attempted=true;transferred=true;submit(controller,1,list);result.nativeReturned=true;
 }catch(error){result.error=String(error);}finally{
  try{if(built)releasePair(pair);qAssign(q,empty);}catch{result.cleanupError=true;}
  // A partially built list is not submitted or retried; terminate this bridge on cleanup failure.
  if(!transferred&&list.readPointer().compare(m.base.add(0xb40bbc8))!==0)result.cleanupError=true;
 }
 return result;
}
listeners.push(Interceptor.attach(Process.getModuleByName('user32.dll').getExportByName('DispatchMessageW'),{
 onLeave(){if(!pending||busy||Process.getCurrentThreadId()!==contexts.thread)return;const request=pending;pending=null;busy=true;try{request.resolve(execute(request));}finally{busy=false;}}
}));
rpc.exports={
 status(){return {...contexts.status(),busy:busy||!!pending,imagesSupported:!!c.imageFactory?.sendEnabled};},
 sendtext(request){
  if(!c.targets.some(t=>t.id===request.target)||typeof request.text!=='string'||!request.text.trim()||request.text.length>5000||!Array.isArray(request.bytes)||request.bytes.length>20000)return {attempted:false,error:'Invalid test request'};
  if(pending||busy||!contexts.forTarget(request.target))return {attempted:false,error:'Bridge busy or recipient context unavailable'};
  return new Promise(resolve=>{pending={...request,resolve};setTimeout(()=>{if(pending?.resolve===resolve){pending=null;resolve({attempted:false,error:'UI thread unavailable'});}},5000);});
 },
 sendimage(request){
  if(!imageFactory||!c.targets.some(t=>t.id===request.target)||typeof request.imagePath!=='string'||request.imagePath.length>32768||!Number.isSafeInteger(request.fileSize)||request.fileSize<=0||request.fileSize>20971520||!Array.isArray(request.bytes)||request.bytes.length>32768)return {attempted:false,error:'Invalid image request or unsupported profile'};
  if(pending||busy||(!request.probeOnly&&!contexts.forTarget(request.target)))return {attempted:false,error:'Bridge busy or recipient context unavailable'};
  return new Promise(resolve=>{pending={...request,resolve};setTimeout(()=>{if(pending?.resolve===resolve){pending=null;resolve({attempted:false,error:'UI thread unavailable'});}},5000);});
 },
 dispose(){contexts.dispose();if(pending){pending.resolve({attempted:false,error:'Bridge stopped'});pending=null;}for(const l of listeners)l.detach();}
};
