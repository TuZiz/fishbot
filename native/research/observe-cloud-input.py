"""Version-bound passive observer; optional scoped metadata, never send calls."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True)
parser.add_argument('--dependencies', required=True)
parser.add_argument('--module', required=True)
parser.add_argument('--candidates', required=True)
parser.add_argument('--test-marker', help='Exact synthetic filehelper message to inspect; never dump other text')
parser.add_argument('--output', help='Optional JSON evidence path; contains counters only')
parser.add_argument('--seconds', type=int, default=120, help='Observation deadline (5..600 seconds)')
parser.add_argument('--backtrace', action='store_true', help='Record at most three module-only call stacks per candidate; never reads arguments')
parser.add_argument('--stop-file', help='Optional research stop signal file, checked every five seconds')
parser.add_argument('--image-target', help='Authorized test chatroom; inspect metadata only for type-3 messages in this scope')
args = parser.parse_args()
if args.image_target:
    raise RuntimeError('Image metadata hooks quarantined after client crash and failed identity validation; offline analysis only')
if not 5 <= args.seconds <= 600 or args.seconds % 5:
    raise RuntimeError('Observation deadline must be a multiple of 5 in 5..600')
if args.image_target:
    import re
    if args.test_marker or not re.fullmatch(r'[0-9]{5,20}@chatroom', args.image_target):
        raise RuntimeError('Image metadata requires an exact test chatroom and no text marker')
if args.test_marker and (not args.test_marker.isascii() or not args.test_marker.startswith('FishBot_') or len(args.test_marker) > 100):
    raise RuntimeError('Expected a short ASCII FishBot_ synthetic marker')
if hashlib.sha256(Path(args.module).read_bytes()).hexdigest() != 'e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556':
    raise RuntimeError('Unsupported DLL fingerprint')
sys.path.insert(0, args.dependencies)
import frida

allowed = {'input_voice_to_txt_send', 'text-factory-candidate', 'submit-candidate', 'background-candidate', 'global-service-candidate', 'image-download-candidate'}
specs = {c['rva']: c for c in json.loads(Path(args.candidates).read_text()) if c['label'] in allowed}
quarantined = {0x1820b20,0x1813980,0x3a5c4a0,0x3a5ccc0,0x3a56860}
if any(int(rva,0) in quarantined for rva in specs):
    raise RuntimeError('Download resource hook set quarantined after client crash; offline analysis only')
if not 1 <= len(specs) <= 5:
    raise RuntimeError('Expected one to five offline candidates')
agent = r'''
const specs=CONFIG,m=Process.getModuleByName('Weixin.dll'),hooks=[],hits={},marker=MARKER,trace=TRACE,imageTarget=IMAGE_TARGET;
function exact(p,text){const n=p.add(16).readU64().toNumber(),cap=p.add(24).readU64().toNumber();if(n!==text.length||cap<n||cap>32768)return false;return (cap<16?p:p.readPointer()).readUtf8String(n)===text;}
function serviceLayout(args,thread){
 if(!marker)return null;
 try{
  const v=args[2],begin=v.readPointer(),end=v.add(8).readPointer(),capacity=v.add(16).readPointer();
  if(end.sub(begin).toInt32()!==16||capacity.compare(end)<0)return null;
  const object=begin.readPointer();
  if(!exact(object.add(0x758),marker)||!exact(object.add(0xb0),'filehelper'))return null;
  send({event:'synthetic-global-layout',thread,vectorCount:1,targetMatched:true,messageVtable:object.readPointer().sub(m.base).toString(),serviceVtable:args[0].readPointer().sub(m.base).toString()});
  return args[1];
 }catch(e){send({event:'global-layout-unavailable',error:String(e)});return null;}
}
function examine(name,args,thread){
 if(!marker||name!=='submit-candidate')return;
 try {
  const list=args[2].readPointer(),begin=list.add(8).readS32(),end=list.add(12).readS32();
  if(begin<0||end-begin!==1||end>64)return;
  const obj=list.add(16+begin*8).readPointer().readPointer();
  if(!exact(obj.add(0x758),marker))return;
  const controller=args[0],d=controller.add(8).readPointer();
  send({event:'synthetic-submit-layout',thread,mode:args[1].toUInt32(),messageType:obj.add(0x118).readU32(),messageVtable:obj.readPointer().sub(m.base).toString(),controllerVtable:controller.readPointer().sub(m.base).toString(),filehelperAt176:exact(controller.add(176),'filehelper'),qobjectSelf:d.add(8).readPointer().equals(controller)});
 }catch(e){send({event:'layout-unavailable',error:String(e)});}
}
let imageEvents=0,imageReadErrors=0;
function imageMetadata(rva,args,thread){
 if(!imageTarget||imageEvents>=40)return;
 try{
  const direct=rva==='0x3a5ccc0';
  const pair=rva==='0x3a5c4a0'?args[1]:args[2];
  if(!direct&&!['0x3a5c4a0','0x1813980','0x1820b20','0x3a56860'].includes(rva))return;
  const model=direct?args[1]:pair.readPointer();
  if(model.isNull()||model.add(12).readU32()!==3)return;
  // Offline MessageWrapper peer/recipient fields. Never read body/XML/CDN fields.
  const peerMatched=exact(model.add(0x18),imageTarget)||exact(model.add(0x38),imageTarget);
  const keyScopeMatched=exact(model.add(0x70),imageTarget);
  if(!peerMatched&&!keyScopeMatched)return;
  const id=model.add(0xc8).readU64().toString();
  if(id==='0')return;
  const kind=(direct?args[2]:(rva==='0x3a5c4a0'?args[2]:args[3])).toUInt32();
  const priority=direct?null:(rva==='0x3a5c4a0'?args[3]:args[4]).toUInt32();
  const vtable=model.readPointer();
  if(vtable.compare(m.base)<0||vtable.compare(m.base.add(m.size))>=0)return;
  imageEvents++;
  const nestedSameObject=model.add(0x2c0).readPointer().equals(model);
  const nestedSameControl=direct?null:model.add(0x2c8).readPointer().equals(pair.add(8).readPointer());
  send({event:'test-image-metadata',at:Date.now(),rva,thread,targetMatched:true,peerMatched,keyScopeMatched,messageType:3,serverId:id,localId:model.add(0xd0).readU32(),modelVtable:vtable.sub(m.base).toString(),kind,priority,nestedSameObject,nestedSameControl});
 }catch{imageReadErrors++;}
}
let selfHits=0;
const address=Process.getModuleByName('kernel32.dll').getExportByName('GetCurrentProcessId');
const sanity=Interceptor.attach(address,{onEnter(){selfHits++;}});
Interceptor.flush();const pid=new NativeFunction(address,'uint32',[])();sanity.detach();
if(pid!==Process.id||!selfHits)throw Error('Interceptor self-check failed');
for(const c of specs){const p=m.base.add(ptr(c.rva)),actual=Array.from(new Uint8Array(p.readByteArray(16)),b=>b.toString(16).padStart(2,'0')).join('');if(actual!==c.prologue)throw Error('Fingerprint mismatch');}
function recordHit(rva,call){
 const h=hits[rva],caller=call.returnAddress.sub(m.base).toString();h.count++;
 if(Object.keys(h.threads).length<32||call.threadId in h.threads)h.threads[call.threadId]=(h.threads[call.threadId]||0)+1;
 if(Object.keys(h.callers).length<32||caller in h.callers)h.callers[caller]=(h.callers[caller]||0)+1;
 if(trace&&h.stacks.length<3){
  try{h.stacks.push({thread:call.threadId,frames:Thread.backtrace(call.context,Backtracer.ACCURATE).filter(p=>p.compare(m.base)>=0&&p.compare(m.base.add(m.size))<0).slice(0,16).map(p=>p.sub(m.base).toString())});}
  catch{h.traceErrors++;}
 }
}
for(const c of specs){
 hits[c.rva]={count:0,callers:{},threads:{},stacks:[],traceErrors:0};
 hooks.push(Interceptor.attach(m.base.add(ptr(c.rva)),{
  onEnter(args){recordHit(c.rva,this);imageMetadata(c.rva,args,this.threadId);examine(c.label,args,this.threadId);if(c.label==='global-service-candidate')this.output=serviceLayout(args,this.threadId);},
  onLeave(){if(this.output){try{const operation=this.output.add(0x38).readPointer();send({event:'synthetic-operation-layout',operationVtable:operation.readPointer().sub(m.base).toString()});}catch{send({event:'operation-layout-unavailable'});}}}
 }));
}
Interceptor.flush();rpc.exports={snapshot(){return hits;},dispose(){for(const h of hooks)h.detach();if(imageTarget)send({event:'image-metadata-summary',matchedEvents:imageEvents,readErrors:imageReadErrors});}};
send({event:'ready',pid,selfHits,readsArguments:!!marker||!!imageTarget,syntheticMarkerOnly:!!marker,testImageMetadataOnly:!!imageTarget,canSend:false});
'''.replace('CONFIG', json.dumps(list(specs.values()))).replace('MARKER', json.dumps(args.test_marker)).replace('TRACE', json.dumps(args.backtrace)).replace('IMAGE_TARGET', json.dumps(args.image_target))
session = frida.attach(args.pid)
script = None
report = {'pid': args.pid, 'version': '4.1.15.56', 'canSend': False, 'samples': [], 'events': []}
try:
    script = session.create_script(agent)
    def on_message(message, data):
        if message.get('type') == 'send':
            report['events'].append(message['payload'])
        print(json.dumps(message), flush=True)
    script.on('message', on_message)
    script.load()
    for sample in range(args.seconds // 5):
        time.sleep(5)
        entry = {'sample': sample, 'hits': script.exports_sync.snapshot()}
        report['samples'].append(entry)
        print(json.dumps(entry), flush=True)
        if args.stop_file and Path(args.stop_file).is_file():
            report['stoppedBySignal'] = True
            break
finally:
    try:
        if script:
            try:
                script.exports_sync.dispose()
            finally:
                script.unload()
    finally:
        try:
            session.detach()
        finally:
            if args.output:
                report['completed'] = len(report['samples']) == args.seconds // 5
                Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
