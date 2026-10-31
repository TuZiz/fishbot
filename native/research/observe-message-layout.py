"""Bounded, read-only observation of one synthetic memo send. Never calls client functions."""
import hashlib
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.abspath('../.tools/hook-research'))
import frida
import pefile

ROOT = Path('data/research/native')
EXPECTED_SHA256 = '2b3677c3f932daaa4ef84c8b2acd0aee12cbe5a779ff9e740c370761e5c291ce'
meta = json.loads((ROOT / 'process-metadata.json').read_text(encoding='utf-8-sig'))
target = json.loads((ROOT / 'test-target.json').read_text(encoding='utf-8-sig'))
if meta['version'] != '4.2.0.12' or not target['testText'].startswith('FishBot_'):
    raise RuntimeError('Unsupported version or non-synthetic marker')
with open(meta['module'], 'rb') as source:
    if hashlib.file_digest(source, 'sha256').hexdigest() != EXPECTED_SHA256:
        raise RuntimeError('Module fingerprint mismatch')
pe = pefile.PE(meta['module'], fast_load=True)
sites = [0x3e863e0, 0x3e88670, 0x3e8a0e0, 0x3e8c000]
config = {
    'marker': list(target['testText'].encode()),
    'target': list(target['conversationId'].encode()),
    'sites': [{'rva': rva, 'prologue': pe.get_data(rva, 16).hex()} for rva in sites],
}
agent = r'''
const config=CONFIG, module=Process.getModuleByName('Weixin.dll');
if(Process.arch!=='x64'||!module.path.toLowerCase().includes('4.2.0.12'))throw Error('Module mismatch');
const records=[],counts={},listeners=[];
let expires=0;
function matchesString(p,expected){
 const length=p.add(16).readU64(),capacity=p.add(24).readU64();
 if(length.compare(expected.length)!==0||capacity.compare(length)<0||capacity.compare(4096)>0)return false;
 const data=capacity.compare(16)<0?p:p.readPointer();
 const bytes=new Uint8Array(data.readByteArray(expected.length));
 return expected.every((v,i)=>bytes[i]===v);
}
function inspectObject(object,pair,context){
 if(object.add(0x118).readU32()!==1||!matchesString(object.add(0x758),config.marker))return;
 const targetOffsets=[];
 for(let offset=0x20;offset<0x740;offset+=8){try{if(matchesString(object.add(offset),config.target))targetOffsets.push(offset);}catch{}}
 records.push({...context,messageType:1,sourceCategory:object.add(0x9c).readU32(),flag108:object.add(0x108).readU8(),markerMatched:true,targetOffsets,vtableRva:object.readPointer().sub(module.base).toString(),sharedControlPresent:!pair.add(8).readPointer().isNull()});
 expires=Date.now()+1500;
}
function inspectList(address,context){
 try{
  const header=address.readPointer(),begin=header.add(8).readS32(),end=header.add(12).readS32();
  if(begin<0||end<=begin||end-begin>4||end>64)return;
  for(let i=begin;i<end;i++){
   const pair=header.add(16+i*8).readPointer(),object=pair.readPointer();
   inspectObject(object,pair,context);
  }
 }catch{counts.layoutReadFailures=(counts.layoutReadFailures||0)+1;}
}
for(const site of config.sites){
 const bytes=new Uint8Array(module.base.add(site.rva).readByteArray(16));
 if(Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')!==site.prologue)throw Error('Runtime code mismatch');
}
for(const site of config.sites){
 counts[site.rva]=0;
 listeners.push(Interceptor.attach(module.base.add(site.rva),{onEnter(args){
  if(records.length>=12)return;
  counts[site.rva]++;
  const context={siteRva:'0x'+site.rva.toString(16),threadId:Process.getCurrentThreadId(),callerRva:this.returnAddress.sub(module.base).toString()};
  try{
   const controller=site.rva===0x3e8a0e0?args[0].add(8).readPointer():site.rva===0x3e8c000?args[0].readPointer():args[0];
   context.controllerTargetMatched=matchesString(controller.add(0x10).readPointer().add(0x260),config.target);
   if(site.rva===0x3e8c000){
    const vector=args[0].add(0x28).readPointer(),begin=vector.readPointer(),end=vector.add(8).readPointer();
    const count=end.sub(begin).toInt32()/16;
    if(Number.isInteger(count)&&count>0&&count<=4)for(let i=0;i<count;i++){const pair=begin.add(i*16);inspectObject(pair.readPointer(),pair,context);}
   }else inspectList(site.rva===0x3e863e0?args[2]:site.rva===0x3e88670?args[3]:args[0].add(0x40),context);
  }catch{counts.layoutReadFailures=(counts.layoutReadFailures||0)+1;}
 }}));
}
rpc.exports={snapshot(){return {records,counts,done:expires>0&&Date.now()>expires};},dispose(){for(const listener of listeners)listener.detach();}};
send({event:'layout-observer-ready',sites:config.sites.length,rawTextStored:false,canSend:false});
'''.replace('CONFIG', json.dumps(config))
session = None
script = None
result = {'canSend': False, 'observationOnly': True, 'version': meta['version']}
try:
    session = frida.attach(meta['pid'])
    script = session.create_script(agent)
    script.on('message', lambda message, data: print(json.dumps(message), flush=True))
    script.load()
    for _ in range(150):
        time.sleep(1)
        observation = script.exports_sync.snapshot()
        if observation['done']:
            break
    result.update(script.exports_sync.snapshot())
finally:
    if script:
        try:
            script.exports_sync.dispose()
            script.unload()
        except Exception as error:
            result['cleanupError'] = type(error).__name__
    if session:
        try:
            session.detach()
        except Exception as error:
            result['detachError'] = type(error).__name__
    (ROOT / 'message-layout-observation.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result), flush=True)
