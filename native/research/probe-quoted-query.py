"""Version-bound quoted-message query probe. Default: construct/release empty result only.

No interceptors, download requests, sends, UI actions or paid APIs. Real reference
queries are quarantined: the RPC thread lacks a verified WeChat execution context.
"""
import os
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', required=True)
p.add_argument('--dependencies', required=True)
p.add_argument('--output', required=True)
p.add_argument('--query-reference', metavar='IDENTITY_JSON', help='Quarantined; always rejected before reading profile, input or attaching')
p.add_argument('--empty-query-abi', action='store_true', help='Validate query fast path with hardcoded zero ID; never query a real message')
p.add_argument('--inspect-context', action='store_true', help='Only read application dispatch metadata; no native calls')
args = p.parse_args()
if args.query_reference:
    p.error('Real reference query disabled: native RPC execution raised an access violation; verified task context and cleanup are required first')
if args.empty_query_abi and args.query_reference:
    raise RuntimeError('Empty ABI and real reference modes are mutually exclusive')
if args.inspect_context and (args.empty_query_abi or args.query_reference):
    raise RuntimeError('Read-only context mode must run alone')
profile = json.loads((Path(args.root)/'cloud-profile.json').read_text(encoding='utf-8-sig'))
if hashlib.sha256(Path(profile['module']).read_bytes()).hexdigest() != 'e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556':
    raise RuntimeError('Unsupported query DLL fingerprint')
expected = None
if args.query_reference:
    expected = json.loads(Path(args.query_reference).read_text(encoding='utf-8-sig'))
    if (expected.get('conversationId') not in ({os.environ.get('FISHBOT_TEST_GROUP_ID', ''),os.environ.get('FISHBOT_TEST_GROUP_2_ID', '')} - {''})
            or not re.fullmatch(r'[1-9][0-9]{0,18}', str(expected.get('serverId','')))
            or int(expected['serverId']) > 9223372036854775807
            or type(expected.get('localId')) is not int or not 0 < expected['localId'] <= 0xffffffff
            or not isinstance(expected.get('senderId'),str) or not re.fullmatch(r'[A-Za-z0-9_@.-]{1,256}',expected['senderId'])):
        raise RuntimeError('Invalid database-verified quoted photo identity')
sys.path.insert(0,args.dependencies)
import frida

source = r'''
const expected=EXPECTED,emptyQuery=EMPTY_QUERY,m=Process.getModuleByName('Weixin.dll');
if(Process.arch!=='x64')throw Error('Unexpected query architecture');
for(const [rva,hex] of [[0x3991600,'5556574881ec40030000488dac248000'],[0x391a010,'5541574156415541545657534881eca8'],[0x7554c70,'40534883ec20488b59084885db743983']]){
 const actual=Array.from(new Uint8Array(m.base.add(rva).readByteArray(16)),x=>x.toString(16).padStart(2,'0')).join('');
 if(actual!==hex)throw Error('Query runtime fingerprint mismatch');
}
const empty=new NativeFunction(m.base.add(0x3991600),'pointer',['pointer']);
const query=new NativeFunction(m.base.add(0x391a010),'pointer',['pointer','pointer','pointer','uint64','uint']);
const release=new NativeFunction(m.base.add(0x7554c70),'void',['pointer']);
let pair=null,peer=null,peerBytes=null,started=false,released=false,stage='not-started';
function exact(address,text){
 const n=address.add(16).readU64().toNumber(),cap=address.add(24).readU64().toNumber();
 return n===text.length&&cap>=n&&cap<=32768&&(cap<16?address:address.readPointer()).readUtf8String(n)===text;
}
function checkPair(){
 if(!pair)throw Error('Query not started');
 const state=pair.readPointer(),control=pair.add(8).readPointer();
 if(state.isNull()||control.isNull()||!state.equals(control.add(16))||!control.readPointer().equals(m.base.add(0x8f52418)))throw Error('Unexpected result ownership');
 const strong=control.add(8).readU32(),weak=control.add(12).readU32();
 if(strong<1||strong>64||weak<1||weak>64)throw Error('Unexpected result reference count');
 return state;
}
rpc.exports={
 applicationcontext(){
  const application=m.base.add(0xbb92fa0).readPointer();
  if(application.isNull())return {present:false};
  const vtable=application.readPointer(),method=vtable.add(0x60).readPointer();
  if(vtable.compare(m.base)<0||vtable.compare(m.base.add(m.size))>=0||method.compare(m.base)<0||method.compare(m.base.add(m.size))>=0)throw Error('Application dispatch outside verified module');
  const context=application.add(0x68).readPointer(),control=application.add(0x70).readPointer();
  const result={present:true,applicationVtableRva:vtable.sub(m.base).toString(),contextMethodRva:method.sub(m.base).toString(),contextPresent:!context.isNull(),contextOwnerPresent:!control.isNull(),nativeCalls:0};
  if(!context.isNull())result.componentStorePresent=!context.add(0x28).readPointer().isNull();
  return result;
 },
 start(){
  if(started)throw Error('Query probe cannot repeat');started=true;
  pair=Memory.alloc(16);pair.writeByteArray(new Uint8Array(16));
  let returned;
  if(expected||emptyQuery){
   if(expected&&m.base.add(0xbb92fa0).readPointer().isNull())throw Error('Query application context unavailable');
   peer=Memory.alloc(32);peer.writeByteArray(new Uint8Array(32));
   if(expected){
    peerBytes=Memory.allocUtf8String(expected.conversationId);
    peer.writePointer(peerBytes);peer.add(16).writeU64(expected.conversationId.length);peer.add(24).writeU64(expected.conversationId.length);
   }else{peer.add(24).writeU64(15);}
   stage='query-call';returned=query(ptr(0),pair,peer,uint64(expected?.serverId??'0'),0);
  }else{stage='empty-call';returned=empty(pair);}
  stage='result-returned';
  if(!returned.equals(pair))throw Error('Query output ABI mismatch');
  checkPair();stage='ownership-checked';return {started:true,emptyOnly:!expected,hooks:0,downloads:0,sends:0};
 },
 poll(){
  const state=checkPair(),status=state.add(0xc4).readU32();
  if(status===0)return {complete:false};
  if(status!==1)return {complete:true,resultStatus:status,identityMatched:false};
  const wrapper=state.add(0xb8).readPointer();
  if(wrapper.isNull()||!wrapper.readPointer().equals(m.base.add(0x96e3318)))throw Error('Unexpected result type');
  const model=wrapper.add(8),present=model.add(0x2e8).readU8();
  if(present>1)throw Error('Invalid optional model state');
  if(!expected)return {complete:true,emptyOnly:true,resultStatus:status,emptyResult:present===0};
  if(!present)return {complete:true,resultStatus:status,found:false,identityMatched:false};
  const vtableMatched=model.readPointer().equals(m.base.add(0x8f71468));
  const typeMatched=model.add(12).readU32()===3;
  const scopeMatched=exact(model.add(0x18),expected.conversationId)||exact(model.add(0x38),expected.conversationId);
  const senderMatched=exact(model.add(0x18),expected.senderId)||exact(model.add(0x38),expected.senderId)||exact(model.add(0x58),expected.senderId);
  const serverMatched=model.add(0x148).readU64().compare(uint64(expected.serverId))===0;
  const localMatched=model.add(0x144).readU32()===expected.localId;
  return {complete:true,resultStatus:status,found:true,vtableMatched,typeMatched,scopeMatched,senderMatched,serverMatched,localMatched,
   identityMatched:vtableMatched&&typeMatched&&scopeMatched&&senderMatched&&serverMatched&&localMatched};
 },
 diagnostics(){
  const result={stage,pairAllocated:!!pair};
  if(pair){try{result.statePresent=!pair.readPointer().isNull();result.controlPresent=!pair.add(8).readPointer().isNull();}catch{result.unreadable=true;}}
  return result;
 },
 dispose(){
  if(pair&&!released){checkPair();release(pair);released=true;pair=null;peer=null;peerBytes=null;}
  return {released};
 }
};
'''.replace('EXPECTED',json.dumps(expected)).replace('EMPTY_QUERY',json.dumps(args.empty_query_abi))
report={'mode':'quoted-query' if expected else 'empty-query-abi' if args.empty_query_abi else 'empty-result','hooks':0,'downloads':0,'sends':0,'paidRequests':0,'automaticDownloadVerified':False}
session=frida.attach(profile['pid'])
script=None
failed=False
try:
    script=session.create_script(source)
    script.load()
    if args.inspect_context:
        report['mode']='context-readonly'
        report['context']=script.exports_sync.applicationcontext()
    else:
        report['start']=script.exports_sync.start()
        deadline=time.monotonic()+15
        while True:
            report['result']=script.exports_sync.poll()
            if report['result']['complete'] or time.monotonic()>=deadline:
                break
            time.sleep(0.1)
except Exception as error:
    failed=True
    report['failed']=True
    known=['Query output ABI mismatch','Unexpected result ownership','Unexpected result reference count','Unexpected result type','Invalid optional model state','access violation','expected a pointer','expected an integer']
    report['failureCode']=next((code for code in known if code.lower() in str(error).lower()),'NativeOrAgentError')
    report['failureMessage']=re.sub(r'0x[0-9a-fA-F]+','[address]',str(error).splitlines()[0])[:160]
    if script is not None:
        try:
            report['diagnostics']=script.exports_sync.diagnostics()
        except Exception:
            report['diagnostics']={'unavailable':True}
finally:
    if script is not None:
        try:
            report['cleanup']=script.exports_sync.dispose()
        except Exception:
            failed=True
            report['cleanup']={'released':False,'failed':True}
        script.unload()
    session.detach()
    Path(args.output).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
if failed:
    raise SystemExit(1)
