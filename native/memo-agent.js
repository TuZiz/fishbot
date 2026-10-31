// Experimental, fingerprint-bound memo backend. No keyboard, OCR or desktop control.
const c=CONFIG,m=Process.getModuleByName('Weixin.dll'),listeners=[];
if(Process.arch!=='x64')throw Error('Unsupported architecture');
let controller=null,factory=null,thread=0,mode=0,captured=0,pending=null,busy=false;
function matches(p,bytes){
 if(p.add(16).readU64().compare(bytes.length)!==0)return false;
 const capacity=p.add(24).readU64();if(capacity.compare(bytes.length)<0||capacity.compare(32768)>0)return false;
 const data=capacity.compare(16)<0?p:p.readPointer(),value=new Uint8Array(data.readByteArray(bytes.length));
 return bytes.every((v,i)=>value[i]===v);
}
function objectIn(list){const p=list.readPointer(),begin=p.add(8).readS32(),end=p.add(12).readS32();if(begin<0||end-begin!==1||end>64)throw Error('Expected one message');return p.add(16+begin*8).readPointer().readPointer();}
function targetMatches(){return !!controller&&matches(controller.add(0x10).readPointer().add(0x260),c.targetBytes);}
for(const s of c.sites){const bytes=new Uint8Array(m.base.add(s.rva).readByteArray(16));if(Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')!==s.prologue)throw Error('Runtime code mismatch');}
function fn(rva,ret,args){return new NativeFunction(m.base.add(rva),ret,args);}
const qFromUtf8=fn(0x27f80,'pointer',['pointer','pointer','int']),qAssign=fn(0x1adc0,'pointer',['pointer','pointer']);
const makeText=fn(0x3ec5f70,'pointer',['pointer','pointer','pointer']),append=fn(0x1c48c00,'void',['pointer','pointer','pointer','pointer']);
const submit=fn(0x3e863e0,'void',['pointer','uint','pointer']),releasePair=fn(0x76ae350,'void',['pointer']);
listeners.push(Interceptor.attach(m.base.add(0x3ec5f70),{
 onEnter(args){if(busy)return;this.self=args[0];this.output=args[1];},
 onLeave(){if(busy||!this.output)return;try{if(matches(this.output.readPointer().add(0x758),c.warmupBytes))factory={self:this.self,at:Date.now(),thread:Process.getCurrentThreadId()};}catch{}}
}));
listeners.push(Interceptor.attach(m.base.add(0x3e863e0),{
 onEnter(args){if(busy||pending)return;try{if(!factory||Date.now()-factory.at>2000||factory.thread!==Process.getCurrentThreadId())return;const object=objectIn(args[2]);if(object.add(0x118).readU32()!==1||!matches(object.add(0x758),c.warmupBytes))return;const previous=controller;controller=args[0];if(!targetMatches()){controller=previous;return;}thread=Process.getCurrentThreadId();mode=args[1].toUInt32();captured=Date.now();this.valid=true;}catch{}},
 onLeave(){if(this.valid){const vtable=controller.readPointer();send({event:'armed',expiresAt:captured+c.ttlMs});send({event:'lifetime-evidence',vtableRva:vtable.sub(m.base).toString(),entries:Array.from({length:8},(_,i)=>vtable.add(i*8).readPointer().sub(m.base).toString())});}}
}));
function execute(request){
 const result={attempted:false,nativeReturned:false};
 const q=Memory.alloc(8),empty=Memory.alloc(8),pair=Memory.alloc(16),list=Memory.alloc(8);
 q.writePointer(m.base.add(0xb40bb50));empty.writePointer(m.base.add(0xb40bb50));pair.writePointer(ptr(0));pair.add(8).writePointer(ptr(0));list.writePointer(m.base.add(0xb40bbc8));
 let built=false,transferred=false;
 try{
  if(Date.now()-captured>c.ttlMs||!targetMatches())throw Error('Memo context unavailable; warmup required');
  qFromUtf8(q,Memory.allocUtf8String(request.text),request.bytes.length);
  makeText(factory.self,pair,q);built=true;const object=pair.readPointer();
  if(object.readPointer().sub(m.base).toUInt32()!==0x912d238||object.add(0x118).readU32()!==1||!matches(object.add(0x758),request.bytes))throw Error('Constructed message mismatch');
  append(list,pair,ptr(0),ptr(0));if(!objectIn(list).equals(object)||!targetMatches())throw Error('Queue or recipient mismatch');
  result.attempted=true;transferred=true;submit(controller,mode,list);result.nativeReturned=true;
 }catch(error){result.error=String(error);}finally{
  try{if(built)releasePair(pair);qAssign(q,empty);}catch{result.cleanupError=true;}
  // A partially built list is not submitted or retried; terminate this bridge on cleanup failure.
  if(!transferred&&list.readPointer().compare(m.base.add(0xb40bbc8))!==0)result.cleanupError=true;
 }
 return result;
}
listeners.push(Interceptor.attach(Process.getModuleByName('user32.dll').getExportByName('DispatchMessageW'),{
 onLeave(){if(!pending||busy||Process.getCurrentThreadId()!==thread)return;const request=pending;pending=null;busy=true;try{request.resolve(execute(request));}finally{busy=false;}}
}));
rpc.exports={
 status(){let recipientValid=false;try{recipientValid=targetMatches();}catch{}return {ready:!!controller&&recipientValid&&Date.now()-captured<c.ttlMs,busy:busy||!!pending,expiresAt:captured+c.ttlMs};},
 sendtext(request){
  if(request.target!==c.target||typeof request.text!=='string'||!request.text.trim()||request.text.length>5000||!Array.isArray(request.bytes)||request.bytes.length>20000)return {attempted:false,error:'Invalid memo request'};
  if(pending||busy||!controller||Date.now()-captured>c.ttlMs)return {attempted:false,error:'Bridge busy or warmup required'};
  return new Promise(resolve=>{pending={...request,resolve};setTimeout(()=>{if(pending?.resolve===resolve){pending=null;resolve({attempted:false,error:'UI thread unavailable'});}},5000);});
 },
 dispose(){if(pending){pending.resolve({attempted:false,error:'Bridge stopped'});pending=null;}for(const l of listeners)l.detach();}
};
