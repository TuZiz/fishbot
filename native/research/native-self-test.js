// Loaded only by probe-native-send.py after version, hash and instruction checks.
const c=CONFIG,m=Process.getModuleByName('Weixin.dll');
const listeners=[],result={attempted:false,nativeReturned:false,deliveryVerified:false,phase:'waiting-for-warmup'};
let factory=null,controller=null,thread=0,mode=0,captured=0,pending=false;
function exactString(p,bytes){
 if(p.add(16).readU64().compare(bytes.length)!==0)return false;
 const capacity=p.add(24).readU64();
 if(capacity.compare(bytes.length)<0||capacity.compare(4096)>0)return false;
 const data=capacity.compare(16)<0?p:p.readPointer(),value=new Uint8Array(data.readByteArray(bytes.length));
 return bytes.every((v,i)=>value[i]===v);
}
function singleObject(list){
 const header=list.readPointer(),begin=header.add(8).readS32(),end=header.add(12).readS32();
 if(begin<0||end-begin!==1||end>64)throw Error('Expected one message');
 return header.add(16+begin*8).readPointer().readPointer();
}
function targetMatches(p){return exactString(p.add(0x10).readPointer().add(0x260),c.target);}
for(const site of c.sites){
 const bytes=new Uint8Array(m.base.add(site.rva).readByteArray(16));
 if(Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')!==site.prologue)throw Error('Runtime code mismatch');
}
function native(rva,ret,args){return new NativeFunction(m.base.add(rva),ret,args);}
const qFromUtf8=native(0x27f80,'pointer',['pointer','pointer','int']);
const qAssign=native(0x1adc0,'pointer',['pointer','pointer']);
const makeText=native(0x3ec5f70,'pointer',['pointer','pointer','pointer']);
const append=native(0x1c48c00,'void',['pointer','pointer','pointer','pointer']);
const submit=native(0x3e863e0,'void',['pointer','uint','pointer']);
const releasePair=native(0x76ae350,'void',['pointer']);
listeners.push(Interceptor.attach(m.base.add(0x3ec5f70),{
 onEnter(args){if(result.attempted)return;this.factoryThis=args[0];this.output=args[1];},
 onLeave(){if(result.attempted||!this.output)return;try{
  if(exactString(this.output.readPointer().add(0x758),c.warmup))factory={self:this.factoryThis,at:Date.now(),thread:Process.getCurrentThreadId()};
 }catch{}}
}));
listeners.push(Interceptor.attach(m.base.add(0x3e863e0),{
 onEnter(args){
  if(result.attempted||pending)return;
  try{
   if(!factory||Date.now()-factory.at>2000||factory.thread!==Process.getCurrentThreadId())return;
   const object=singleObject(args[2]);
   if(object.add(0x118).readU32()!==1||!exactString(object.add(0x758),c.warmup)||!targetMatches(args[0]))return;
   controller=args[0];thread=Process.getCurrentThreadId();mode=args[1].toUInt32();captured=Date.now();this.verified=true;
  }catch{}
 },
 onLeave(){if(this.verified){pending=true;result.phase='armed-on-confirmed-ui-thread';send({event:'native-probe-armed',threadId:thread,targetMatched:true});}}
}));
function execute(){
 pending=false;
 if(Date.now()-captured>15000||!targetMatches(controller))throw Error('Warmup expired or conversation changed');
 result.attempted=true;result.phase='constructing';
 const q=Memory.alloc(8),empty=Memory.alloc(8),pair=Memory.alloc(16),list=Memory.alloc(8);
 q.writePointer(m.base.add(0xb40bb50));empty.writePointer(m.base.add(0xb40bb50));
 pair.writePointer(ptr(0));pair.add(8).writePointer(ptr(0));list.writePointer(m.base.add(0xb40bbc8));
 let built=false,transferred=false;
 try{
  qFromUtf8(q,Memory.allocUtf8String(c.text),c.marker.length);
  makeText(factory.self,pair,q);built=true;
  const object=pair.readPointer();
  if(object.readPointer().sub(m.base).toUInt32()!==0x912d238||object.add(0x118).readU32()!==1||!exactString(object.add(0x758),c.marker))throw Error('Constructed message validation failed');
  append(list,pair,ptr(0),ptr(0));
  if(!singleObject(list).equals(object)||!targetMatches(controller))throw Error('Queue object or target validation failed');
  result.phase='calling-submit';transferred=true;
  submit(controller,mode,list);
  result.nativeReturned=true;result.phase='awaiting-independent-database-verification';
 }finally{
  // submit consumes its QList argument; the independently owned shared_ptr is released once.
  if(built)releasePair(pair);
  qAssign(q,empty);
  if(!transferred&&list.readPointer().compare(m.base.add(0xb40bbc8))!==0)result.cleanupIncomplete=true;
 }
}
const dispatch=Process.getModuleByName('user32.dll').getExportByName('DispatchMessageW');
listeners.push(Interceptor.attach(dispatch,{
 onLeave(){
  if(!pending||result.attempted||Process.getCurrentThreadId()!==thread)return;
  try{execute();}catch(error){pending=false;result.phase='failed-or-unknown';result.error=String(error);}
  send({event:'native-probe-result',...result});
 }
}));
rpc.exports={snapshot(){return result;},dispose(){pending=false;for(const listener of listeners)listener.detach();}};
send({event:'native-probe-ready',requiresSyntheticWarmup:true,oneAttemptOnly:true,readsCredentials:false});
