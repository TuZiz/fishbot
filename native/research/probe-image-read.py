"""Read one cached V2 image through WeChat's own decoder; no keys or image bytes are exported to logs."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

p=argparse.ArgumentParser()
p.add_argument('--root',required=True)
p.add_argument('--dependencies',required=True)
p.add_argument('--input-json',required=True)
p.add_argument('--observe-preview',action='store_true')
p.add_argument('--rpc-thread',action='store_true',help='No UI interceptor; safe alongside the production UI hook')
p.add_argument('--reader-module',action='store_true',help='Verify the production RPC-only reader module')
p.add_argument('--ffmpeg',help='Verify wxgf conversion in memory; no image is saved')
p.add_argument('--json-bytes',action='store_true',help='Internal pipe only: caller must consume bytes without logging stdout')
args=p.parse_args()
root=Path(args.root)
config=json.loads((root/'cloud-profile.json').read_text(encoding='utf-8-sig'))
if hashlib.sha256(Path(config['module']).read_bytes()).hexdigest()!='e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556':
    raise RuntimeError('Unsupported image decoder fingerprint')
source_info=json.loads(Path(args.input_json).read_text(encoding='utf-8-sig'))
image=Path(source_info['path']).resolve(strict=True)
cache=Path(source_info['root']).resolve(strict=True)
if not image.is_relative_to(cache) or image.suffix.lower()!='.dat' or not 15<=image.stat().st_size<=20*1024*1024:
    raise RuntimeError('Invalid cached image probe input')
sys.path.insert(0,args.dependencies)
import frida
source=r"""
const m=Process.getModuleByName('Weixin.dll');
for(const [rva,hex] of [[0xaa7d10,'5541574156415541545657534881ecb8'],[0x2010,'4883ec28488b41184883f8107234488b']]){
 const actual=Array.from(new Uint8Array(m.base.add(rva).readByteArray(16)),b=>b.toString(16).padStart(2,'0')).join('');if(actual!==hex)throw Error('Image decoder runtime mismatch');
}
const read=new NativeFunction(m.base.add(0xaa7d10),'uint',['pointer','pointer']);
const destroy=new NativeFunction(m.base.add(0x2010),'pointer',['pointer']);
let pending=null,last={};
function decodeBytes(path){
 // aa7d10 uses std::string (SSO capacity 15), then converts UTF-8 to QString.
 // A std::wstring supplied here truncates the path at its first zero byte.
 const input=Memory.alloc(32),text=Memory.allocUtf8String(path),output=Memory.alloc(32);
 const length=unescape(encodeURIComponent(path)).length;
 input.writeByteArray(new Uint8Array(32));output.writeByteArray(new Uint8Array(32));
 input.writePointer(text);input.add(16).writeU64(length);input.add(24).writeU64(Math.max(16,length));output.add(24).writeU64(15);
 try{const code=read(input,output);const length=output.add(16).readU64().toNumber(),capacity=output.add(24).readU64().toNumber();last={code:code|0,length,capacity,thread:Process.getCurrentThreadId()};
  if(length<1||length>20971520||capacity<length||capacity>33554432)return new ArrayBuffer(0);
  return (capacity<16?output:output.readPointer()).readByteArray(length);
 }finally{destroy(output);}
}
const rpcThread=RPC_THREAD;
const listener=rpcThread?null:Interceptor.attach(Process.getModuleByName('user32.dll').getExportByName('DispatchMessageW'),{onLeave(){if(!pending||Process.getCurrentThreadId()!==1432)return;const request=pending;pending=null;try{request.resolve(decodeBytes(request.path));}catch{last={error:'DecoderFailure'};request.resolve(new ArrayBuffer(0));}}});
rpc.exports={decode(path){if(rpcThread)return decodeBytes(path);return new Promise(resolve=>{pending={path,resolve};setTimeout(()=>{if(pending?.resolve===resolve){pending=null;last={error:'UIThreadUnavailable'};resolve(new ArrayBuffer(0));}},5000);});},diagnostics(){return last;},dispose(){listener?.detach();}};
"""
source=source.replace('RPC_THREAD','true' if args.rpc_thread else 'false')
if args.reader_module:
    if args.observe_preview:
        raise RuntimeError('Production reader check has no preview observer')
    source=(root/'cached-image-reader.js').read_text(encoding='utf-8-sig')
if args.observe_preview:
    source += r'''
const expectedPaths=EXPECTED_PATHS.map(p=>p.toLowerCase());
function cachedPath(p){try{const n=p.add(16).readU64().toNumber(),cap=p.add(24).readU64().toNumber();if(n<1||n>32768||cap<n||cap>32768)return null;const path=(cap<8?p:p.readPointer()).readUtf16String(n);return expectedPaths.includes(path.toLowerCase())?path:null;}catch{return null;}}
const entry=m.base.add(0xaae960),actual=Array.from(new Uint8Array(entry.readByteArray(16)),b=>b.toString(16).padStart(2,'0')).join('');if(actual!=='555657534881ecf8010000488dac2480')throw Error('Reader context runtime mismatch');
Interceptor.attach(entry,{onEnter(args){this.path=cachedPath(args[1]);},onLeave(){if(this.path){try{const bytes=decodeBytes(this.path);send({event:'context-decoder',diagnostics:last},bytes);}catch{send({event:'context-decoder-failed'});}}}});
Interceptor.attach(m.base.add(0xaa7d10),{onEnter(args){this.match=!!cachedPath(args[0]);this.output=args[1];},onLeave(code){if(!this.match)return;const n=this.output.add(16).readU64().toNumber(),cap=this.output.add(24).readU64().toNumber();if(n>0&&n<=20971520&&cap>=n&&cap<=33554432)send({event:'native-decoded',code:code.toInt32()},(cap<16?this.output:this.output.readPointer()).readByteArray(n));}});
'''.replace('EXPECTED_PATHS',json.dumps(source_info.get('paths',[str(image)])))
session=frida.attach(config['pid'])
script=None
try:
    script=session.create_script(source)
    script.load()
    if args.observe_preview:
        def on_message(message,data):
            if message.get('type')=='send':
                payload=message.get('payload',{})
                print(json.dumps({'event':payload.get('event'),'diagnostics':payload.get('diagnostics'),'bytes':len(data or b''),'matchesExpectedMD5':bool(data) and hashlib.md5(data).hexdigest()==source_info.get('md5')}),flush=True)
        script.on('message',on_message)
        print(json.dumps({'observerReady':True,'syntheticImagesOnly':True,'durationSeconds':90}),flush=True)
        time.sleep(90)
    else:
        decoded=script.exports_sync.readcachedimage(str(image)) if args.reader_module else script.exports_sync.decode(str(image))
        header=decoded[:12]
        fmt='png' if header.startswith(b'\x89PNG\r\n\x1a\n') else 'jpg' if header.startswith(b'\xff\xd8\xff') else 'webp' if header.startswith(b'RIFF') and header[8:12]==b'WEBP' else 'wxgf' if header.startswith(b'wxgf') else 'unsupported'
        converted={}
        if fmt=='wxgf' and args.ffmpeg:
            import subprocess,struct
            command=[args.ffmpeg,'-hide_banner','-loglevel','error','-threads','1','-f','hevc','-i','pipe:0','-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1']
            result=subprocess.run(command,input=decoded,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15,creationflags=0x08000000)
            png=result.stdout
            converted={'conversionExit':result.returncode,'pngBytes':len(png),'pngValid':png.startswith(b'\x89PNG\r\n\x1a\n'),'dimensions':list(struct.unpack('>II',png[16:24])) if len(png)>=24 and png.startswith(b'\x89PNG') else None}
        report={'readOnly':True,'decoderReturnedBytes':len(decoded),'format':fmt,'matchesExpectedMD5':bool(decoded) and hashlib.md5(decoded).hexdigest()==source_info.get('md5'),'imageKeyExtracted':False,'diagnostics':{} if args.reader_module else script.exports_sync.diagnostics(),**converted}
        if args.json_bytes:
            import base64
            report['base64']=base64.b64encode(decoded).decode('ascii')
        print(json.dumps(report),flush=True)
finally:
    if script:
        script.unload()
    session.detach()
