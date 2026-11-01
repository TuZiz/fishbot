"""Bounded read-only heap comparison for one DB-verified quoted photo; no hooks or calls."""
import os
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', required=True)
p.add_argument('--dependencies', required=True)
p.add_argument('--input-json', required=True)
p.add_argument('--output', required=True)
args = p.parse_args()
profile = json.loads((Path(args.root) / 'cloud-profile.json').read_text(encoding='utf-8-sig'))
if hashlib.sha256(Path(profile['module']).read_bytes()).hexdigest() != 'e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556':
    raise RuntimeError('Unsupported DLL fingerprint')
expected = json.loads(Path(args.input_json).read_text(encoding='utf-8-sig'))
if (expected.get('conversationId') not in ({os.environ.get('FISHBOT_TEST_GROUP_ID', ''),os.environ.get('FISHBOT_TEST_GROUP_2_ID', '')} - {''})
        or not re.fullmatch(r'[1-9][0-9]{0,18}', str(expected.get('serverId','')))
        or not 0 < int(expected['serverId']) <= 9223372036854775807
        or type(expected.get('localId')) is not int or not 0 < expected['localId'] <= 0xffffffff
        or not isinstance(expected.get('senderId'), str) or not 1 <= len(expected['senderId']) <= 256):
    raise RuntimeError('Invalid quoted-image identity input')
sys.path.insert(0, args.dependencies)
import frida

source = r'''
const expected=EXPECTED,m=Process.getModuleByName('Weixin.dll');
rpc.exports.inspect=function(){
 const deadline=Date.now()+12000,maxBytes=512*1024*1024,chunk=4*1024*1024;
 const vtable=m.base.add(0x8f71468);
 const pattern=vtable.toString().slice(2).padStart(16,'0').match(/../g).reverse().join(' ');
 let scannedBytes=0,scanErrors=0,objects=0,matched=0,scopeMatched=0,identityMismatch=0;
 const matches=[];
 function exact(address,text){
  const length=address.add(16).readU64().toNumber(),cap=address.add(24).readU64().toNumber();
  if(length!==text.length||cap<length||cap>32768)return false;
  return (cap<16?address:address.readPointer()).readUtf8String(length)===text;
 }
 for(const range of Process.enumerateRanges({protection:'rw-',coalesce:true})){
  if(range.file)continue;
  for(let offset=0;offset<range.size;offset+=chunk){
   if(Date.now()>=deadline||scannedBytes>=maxBytes||objects>=20000)break;
   const count=Math.min(chunk,range.size-offset,maxBytes-scannedBytes);
   let found=[];
   try{found=Memory.scanSync(range.base.add(offset),count,pattern);}catch{scanErrors++;}
   scannedBytes+=count;
   for(const hit of found){
    if(objects++>=20000)break;
    try{
     const object=hit.address;
     if(!object.readPointer().equals(vtable)||object.add(12).readU32()!==3)continue;
     if(!exact(object.add(0x18),expected.conversationId)&&!exact(object.add(0x38),expected.conversationId))continue;
     scopeMatched++;
     const serverMatched=object.add(0x148).readU64().compare(uint64(expected.serverId))===0;
     const localMatched=object.add(0x144).readU32()===expected.localId;
     const senderMatched=exact(object.add(0x18),expected.senderId)||exact(object.add(0x38),expected.senderId)||exact(object.add(0x58),expected.senderId);
     if(!serverMatched||!localMatched){identityMismatch++;continue;}
     matched++;
     if(matches.length<4)matches.push({serverMatched,localMatched,senderMatched,typeMatched:true,scopeMatched:true});
    }catch{scanErrors++;}
   }
  }
  if(Date.now()>=deadline||scannedBytes>=maxBytes||objects>=20000)break;
 }
 return {readOnly:true,hooks:0,nativeCalls:0,downloads:0,sends:0,scannedBytes,scanErrors,objects,scopeMatched,identityMismatch,matched,matches,
  boundedScan:true,identityObserved:matched>0&&matches.some(x=>x.senderMatched),automaticDownloadVerified:false};
};
'''.replace('EXPECTED', json.dumps(expected))
session = frida.attach(profile['pid'])
script = None
try:
    script = session.create_script(source)
    script.load()
    report = script.exports_sync.inspect()
    Path(args.output).write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))
finally:
    if script is not None:
        script.unload()
    session.detach()
