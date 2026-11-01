"""4.1.15.56 ownership probe; explicit flag permits one synthetic filehelper send."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True)
parser.add_argument('--module', required=True)
parser.add_argument('--dependencies', required=True)
parser.add_argument('--fingerprints', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--execute-windowless-filehelper-test', action='store_true')
args = parser.parse_args()
if hashlib.sha256(Path(args.module).read_bytes()).hexdigest() != 'e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556':
    raise RuntimeError('Unsupported DLL fingerprint')
sys.path.insert(0, args.dependencies)
import frida

config = json.loads(Path(args.fingerprints).read_text())
if set(config) != {'0x19b9d10', '0x19e5db0', '0x1949550', '0xf910', '0x5f2b0', '0x7554c70', '0x27f80', '0x1adc0', '0x3e22490', '0x19e5f00'}:
    raise RuntimeError('Unexpected probe functions')
agent = r'''
const m=Process.getModuleByName('Weixin.dll'),specs=CONFIG;
if(Process.arch!=='x64')throw Error('Unexpected architecture');
for(const [rva,expected] of Object.entries(specs)){
 const actual=Array.from(new Uint8Array(m.base.add(ptr(rva)).readByteArray(16)),b=>b.toString(16).padStart(2,'0')).join('');
 if(actual!==expected)throw Error('Runtime fingerprint mismatch');
}
const make=new NativeFunction(m.base.add(0x19b9d10),'pointer',['pointer','pointer','pointer']);
const clone=new NativeFunction(m.base.add(0x19e5db0),'pointer',['pointer']);
const destroy=new NativeFunction(m.base.add(0x1949550),'pointer',['pointer','uint']);
const contextNew=new NativeFunction(m.base.add(0xf910),'pointer',['pointer','pointer','pointer','pointer','pointer','pointer']);
const contextCopy=new NativeFunction(m.base.add(0x5f2b0),'pointer',['pointer','pointer']);
const releasePair=new NativeFunction(m.base.add(0x7554c70),'void',['pointer']);
const fromUtf8=new NativeFunction(m.base.add(0x27f80),'pointer',['pointer','pointer','int']);
const qAssign=new NativeFunction(m.base.add(0x1adc0),'pointer',['pointer','pointer']);
const textNew=new NativeFunction(m.base.add(0x3e22490),'pointer',['pointer','pointer','pointer']);
const execute=new NativeFunction(m.base.add(0x19e5f00),'void',['pointer','pointer']);
function sendProbe(text){
 if(!/^FishBot_Windowless_[0-9]+$/.test(text))throw Error('Only a synthetic filehelper marker is permitted');
 const vector=Memory.alloc(24),output=Memory.alloc(0x58),pair=Memory.alloc(16),q=Memory.alloc(8),empty=Memory.alloc(8);
 const context=Memory.alloc(240),callbacks=[Memory.alloc(64),Memory.alloc(64),Memory.alloc(64)],cancel=Memory.alloc(16);
 for(const [p,n] of [[vector,24],[output,0x58],[pair,16],[context,240],[cancel,16],...callbacks.map(p=>[p,64])])p.writeByteArray(new Uint8Array(n));
 q.writePointer(m.base.add(0xb2a1b50));empty.writePointer(m.base.add(0xb2a1b50));
 let operation=null,built=false,contextBuilt=false;
 const result={attempted:false,nativeReturned:false,target:'filehelper',usesChatController:false,executionThread:Process.getCurrentThreadId(),deliveryVerified:false};
 try{
  fromUtf8(q,Memory.allocUtf8String(text),text.length);textNew(ptr(0),pair,q);built=true;
  const object=pair.readPointer();
  if(!object.readPointer().equals(m.base.add(0x9026b48))||object.add(0x118).readU32()!==1)throw Error('Unexpected new text message');
  const recipient=object.add(0xb0);
  if(recipient.add(16).readU64().toNumber()!==0||recipient.add(24).readU64().toNumber()!==15)throw Error('New message recipient is not empty SSO');
  // Initialize only our newly constructed message, never retarget a live controller or sent message.
  recipient.writeUtf8String('filehelper');recipient.add(16).writeU64(10);
  const body=object.add(0x758),n=body.add(16).readU64().toNumber(),cap=body.add(24).readU64().toNumber();
  if(n!==text.length||(cap<16?body:body.readPointer()).readUtf8String(n)!==text)throw Error('New message body mismatch');
  vector.writePointer(pair);vector.add(8).writePointer(pair.add(16));vector.add(16).writePointer(pair.add(16));
  make(ptr(0),output,vector);operation=output.add(0x38).readPointer();
  if(!operation.readPointer().equals(m.base.add(0x92ea088))||operation.add(16).readPointer().sub(operation.add(8).readPointer()).toInt32()!==16)throw Error('Unexpected operation vector');
  contextNew(context,...callbacks,cancel,ptr(0));contextBuilt=true;
  result.attempted=true;execute(operation,context);result.nativeReturned=true;
 }catch(e){result.error=String(e);}finally{
  try{if(contextBuilt)releasePair(context);if(operation)destroy(operation,1);if(built)releasePair(pair);qAssign(q,empty);}catch(e){result.cleanupError=String(e);}
 }
 return result;
}
function contextProbe(){
 const context=Memory.alloc(240),copy=Memory.alloc(240),callbacks=[Memory.alloc(64),Memory.alloc(64),Memory.alloc(64)],cancel=Memory.alloc(16);
 for(const p of [context,copy])p.writeByteArray(new Uint8Array(240));
 for(const p of callbacks)p.writeByteArray(new Uint8Array(64));cancel.writeByteArray(new Uint8Array(16));
 let created=false,copied=false;
 const empty=p=>[0x48,0x88,0xc8,0xd0,0xd8,0xe0].every(offset=>p.add(offset).readPointer().isNull());
 try{
  if(!contextNew(context,...callbacks,cancel,ptr(0)).equals(context))throw Error('Context constructor return mismatch');
  created=true;if(context.readPointer().isNull()||context.add(8).readPointer().isNull()||!empty(context))throw Error('Unexpected empty context layout');
  const block=context.add(8).readPointer(),before=block.add(8).readU32();
  if(!contextCopy(copy,context).equals(copy))throw Error('Context copy return mismatch');
  copied=true;if(!copy.readPointer().equals(context.readPointer())||!copy.add(8).readPointer().equals(block)||!empty(copy)||block.add(8).readU32()!==before+1)throw Error('Context ownership mismatch');
  return {created:true,copied:true,strongReferenceIncrementVerified:true,emptyCallbacks:true,subscribed:false};
 }finally{
  if(copied&&empty(copy)){releasePair(copy);copy.writePointer(ptr(0));copy.add(8).writePointer(ptr(0));}
  if(created&&empty(context)){releasePair(context);context.writePointer(ptr(0));context.add(8).writePointer(ptr(0));}
 }
}
function valid(p){return !p.isNull()&&p.readPointer().equals(m.base.add(0x92ea088))&&p.add(8).readPointer().isNull()&&p.add(16).readPointer().isNull()&&p.add(24).readPointer().isNull();}
rpc.exports={sendprobe:sendProbe,probe(){
 const vector=Memory.alloc(24),output=Memory.alloc(0x58);
 vector.writeByteArray(new Uint8Array(24));output.writeByteArray(new Uint8Array(0x58));
 let original=null,copy=null;const result={messageCount:0,subscribed:false,canSend:false,created:false,cloned:false,destroyed:0};
 try{
  // Offline analysis proves make's first argument is unused. Input vector is empty.
  if(!make(ptr(0),output,vector).equals(output))throw Error('Unexpected factory return');
  original=output.add(0x38).readPointer();
  if(!valid(original))throw Error('Unexpected empty operation');result.created=true;
  copy=clone(original);if(!valid(copy)||copy.equals(original))throw Error('Unexpected clone');result.cloned=true;
 }finally{
  if(copy&&valid(copy)){destroy(copy,1);result.destroyed++;}
  if(original&&valid(original)){destroy(original,1);output.add(0x38).writePointer(ptr(0));result.destroyed++;}
 }
 result.context=contextProbe();return result;
}};
'''.replace('CONFIG', json.dumps(config))
session = frida.attach(args.pid)
script = None
report = {'version': '4.1.15.56', 'pid': args.pid, 'windowlessSendingVerified': False}
try:
    script = session.create_script(agent)
    script.load()
    report['result'] = script.exports_sync.probe()
    if args.execute_windowless_filehelper_test:
        marker = 'FishBot_Windowless_' + str(int(time.time()))
        report['marker'] = marker
        report['send'] = script.exports_sync.sendprobe(marker)
        # Native scheduler tasks retain their own message/context references; do not resend.
        time.sleep(4)
finally:
    try:
        if script:
            script.unload()
    finally:
        session.detach()
        Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report), flush=True)
