// Cloud 4.1.15.56 only. Appended to the existing agent; no additional hooks or key exports.
(() => {
 const module=Process.getModuleByName('Weixin.dll');
 for(const [rva,hex] of [[0xaa7d10,'5541574156415541545657534881ecb8'],[0x2010,'4883ec28488b41184883f8107234488b']]){
  const actual=Array.from(new Uint8Array(module.base.add(rva).readByteArray(16)),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==hex)throw Error('Cached image reader fingerprint mismatch');
 }
 const decode=new NativeFunction(module.base.add(0xaa7d10),'uint',['pointer','pointer']);
 const destroy=new NativeFunction(module.base.add(0x2010),'pointer',['pointer']);
 rpc.exports.readcachedimage=function(path){
  if(typeof path!=='string'||path.length<1||path.length>32768)throw Error('Invalid cache path');
  const input=Memory.alloc(32),text=Memory.allocUtf8String(path),output=Memory.alloc(32);
  const length=unescape(encodeURIComponent(path)).length;
  input.writeByteArray(new Uint8Array(32));output.writeByteArray(new Uint8Array(32));
  input.writePointer(text);input.add(16).writeU64(length);input.add(24).writeU64(Math.max(16,length));output.add(24).writeU64(15);
  try{
   const code=decode(input,output)|0,n=output.add(16).readU64().toNumber(),capacity=output.add(24).readU64().toNumber();
   if(code<=0||n<1||n>20971520||capacity<n||capacity>33554432)return new ArrayBuffer(0);
   return (capacity<16?output:output.readPointer()).readByteArray(n);
  }finally{destroy(output);}
 };
})();
