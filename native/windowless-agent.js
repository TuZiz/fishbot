// WeChat 4.1.15.56 only. New outgoing objects, global service operation, no chat controller.
const c=CONFIG,m=Process.getModuleByName('Weixin.dll');
if(Process.arch!=='x64'||c.windowlessSites?.length!==9)throw Error('Missing windowless profile');
for(const s of c.windowlessSites){
 const actual=Array.from(new Uint8Array(m.base.add(s.rva).readByteArray(16)),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==s.prologue)throw Error('Windowless runtime fingerprint mismatch');
}
const native=(rva,ret,args)=>new NativeFunction(m.base.add(rva),ret,args);
const make=native(0x19b9d10,'pointer',['pointer','pointer','pointer']);
const destroy=native(0x1949550,'pointer',['pointer','uint']);
const contextNew=native(0xf910,'pointer',['pointer','pointer','pointer','pointer','pointer','pointer']);
const release=native(0x7554c70,'void',['pointer']);
const fromUtf8=native(0x27f80,'pointer',['pointer','pointer','int']);
const qAssign=native(0x1adc0,'pointer',['pointer','pointer']);
const textNew=native(0x3e22490,'pointer',['pointer','pointer','pointer']);
const imageNew=c.imageFactory?native(c.imageFactory.rva,'pointer',['pointer','pointer','pointer']):null;
if(c.imageFactory){const hex=Array.from(new Uint8Array(m.base.add(0x5ddc8c0).readByteArray(16)),b=>b.toString(16).padStart(2,'0')).join('');if(c.imageFactory.rva!==0x5ddc8c0||c.imageFactory.vtable!==0x92b2a88||hex!=='55415741565657534881ece802000048')throw Error('Image factory runtime mismatch');}
const execute=native(0x19e5f00,'void',['pointer','pointer']);
const allocate=native(0x754bcdc,'pointer',['uint64']);
let stopped=false,busy=false;
function exact(p,bytes){
 const n=p.add(16).readU64().toNumber(),cap=p.add(24).readU64().toNumber();
 if(n!==bytes.length||cap<n||cap>32768)return false;
 const data=cap<16?p:p.readPointer(),actual=new Uint8Array(data.readByteArray(n));
 return bytes.every((v,i)=>v===actual[i]);
}
function sendContent(request){
 const image=typeof request.imagePath==='string';
 if(image&&(!imageNew||(!request.probeOnly&&!c.imageFactory.sendEnabled)||!Number.isSafeInteger(request.fileSize)||request.fileSize<=0||request.fileSize>20971520))return {attempted:false,error:'Invalid image file or image capability disabled'};
 const target=c.targets.find(t=>t.id===request.target);
 if(stopped||busy||!target||typeof request.text!=='string'||!request.text.trim()||request.text.length>5000||!Array.isArray(request.bytes)||request.bytes.length<1||request.bytes.length>20000||request.bytes.some(v=>!Number.isInteger(v)||v<0||v>255))return {attempted:false,error:'Invalid windowless request'};
 const encoded=Memory.allocUtf8String(request.text);
 if(encoded.readUtf8String(request.bytes.length)!==request.text)return {attempted:false,error:'UTF-8 length mismatch'};
 busy=true;
 const zero=n=>{const p=Memory.alloc(n);p.writeByteArray(new Uint8Array(n));return p;};
 const vector=zero(24),output=zero(0x58),pair=zero(64),imageOptions=zero(32),q=zero(8),empty=zero(8),context=zero(240),cancel=zero(16),callbacks=[zero(64),zero(64),zero(64)];
 q.writePointer(m.base.add(0xb2a1b50));empty.writePointer(m.base.add(0xb2a1b50));
 let operation=null,built=false,contextBuilt=false;
 const result={attempted:false,nativeReturned:false};
 try{
  fromUtf8(q,encoded,request.bytes.length);
  if(image){imageOptions.add(24).writeU64(15);imageNew(pair,q,imageOptions);}else textNew(ptr(0),pair,q);built=true;
  const object=pair.readPointer();
  if(object.isNull())throw Error('Native content factory returned empty');
  if(image){
   const path=object.add(0x120),cap=path.add(24).readU64().toNumber(),length=path.add(16).readU64().toNumber();
   if(!object.readPointer().equals(m.base.add(0x92b2a88))||object.add(0x118).readU32()!==3||length!==request.imagePath.length||cap<length||cap>32768||(cap<8?path:path.readPointer()).readUtf16String(length)!==request.imagePath||object.add(0x1c8).readU64().compare(request.fileSize)!==0)throw Error('Constructed image mismatch');
   result.constructed=true;if(request.probeOnly)return result;
  }else if(!object.readPointer().equals(m.base.add(0x9026b48))||object.add(0x118).readU32()!==1||!exact(object.add(0x758),request.bytes))throw Error('Constructed text mismatch');
  const recipient=object.add(0xb0),bytes=target.bytes;
  if(!Array.isArray(bytes)||!bytes.length||bytes.length>256||recipient.add(16).readU64().toNumber()!==0||recipient.add(24).readU64().toNumber()!==15)throw Error('Invalid new recipient layout');
  if(bytes.length<16){recipient.writeByteArray(Uint8Array.from([...bytes,0]));}
  else{
   // Native CRT allocation matches this version's std::string destruction path.
   const data=allocate(bytes.length+1);data.writeByteArray(Uint8Array.from([...bytes,0]));
   recipient.writePointer(data);recipient.add(24).writeU64(bytes.length);
  }
  recipient.add(16).writeU64(bytes.length);
  if(!exact(recipient,bytes))throw Error('Recipient binding mismatch');
  vector.writePointer(pair);vector.add(8).writePointer(pair.add(16));vector.add(16).writePointer(pair.add(16));
  make(ptr(0),output,vector);operation=output.add(0x38).readPointer();
  if(operation.isNull()||!operation.readPointer().equals(m.base.add(0x92ea088))||operation.add(16).readPointer().sub(operation.add(8).readPointer()).toInt32()!==16)throw Error('Operation vector mismatch');
  contextNew(context,...callbacks,cancel,ptr(0));contextBuilt=true;
  result.attempted=true;execute(operation,context);result.nativeReturned=true;
 }catch(e){result.error=String(e);}finally{
  try{if(contextBuilt)release(context);if(operation)destroy(operation,1);if(built)release(pair);qAssign(q,empty);}catch{result.cleanupError=true;stopped=true;}
  busy=false;
 }
 return result;
}
rpc.exports={
 status(){return {ready:!stopped,busy,expiresAt:0,state:stopped?'stopped':'windowless-service-ready',requiresChatWindow:false,imagesSupported:!!c.imageFactory?.sendEnabled};},
 sendtext(request){if(request.imagePath!==undefined)return {attempted:false,error:'Wrong content endpoint'};return sendContent(request);},
 sendimage(request){return sendContent({...request,text:request.imagePath});},
 targetstatus(){return [];},
 dispose(){stopped=true;}
};
