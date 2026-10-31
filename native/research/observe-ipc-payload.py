import sys,os,json,time,hashlib
sys.path.insert(0,os.path.abspath('../.tools/hook-research'));import frida,pefile
meta=json.load(open('data/research/native/process-metadata.json',encoding='utf-8-sig'));target=json.load(open('data/research/native/test-target.json'));expected=json.load(open('data/research/native/weixin-static-report.json'))['sha256']
with open(meta['module'],'rb') as f:
 if hashlib.file_digest(f,'sha256').hexdigest()!=expected:raise RuntimeError('Module fingerprint mismatch')
if not target['testText'].startswith('FishBot_'):raise RuntimeError('Only synthetic test markers are accepted')
pe=pefile.PE(meta['module'],fast_load=True)
profile={'target':list(target['conversationId'].encode()),'marker':list(target['testText'].encode()),'wideMarker':list(target['testText'].encode('utf-16-le')),'uiPrologue':pe.get_data(0x3ebb030,16).hex(),'ipcPrologue':pe.get_data(0x3401f20,16).hex()}
agent=r'''
const c=CONFIG,m=Process.getModuleByName('Weixin.dll');
function bytesHex(p){return Array.from(new Uint8Array(p.readByteArray(16)),v=>v.toString(16).padStart(2,'0')).join('');}
if(bytesHex(m.base.add(0x3ebb030))!==c.uiPrologue||bytesHex(m.base.add(0x3401f20))!==c.ipcPrologue)throw Error('Runtime code mismatch');
const result={uiHits:0,packets:[],done:false};let until=0;
function contains(bytes,pattern){outer:for(let i=0;i<=bytes.length-pattern.length;i++){for(let j=0;j<pattern.length;j++)if(bytes[i+j]!==pattern[j])continue outer;return true;}return false;}
const ui=Interceptor.attach(m.base.add(0x3ebb030),{onEnter(){if(result.uiHits)return;result.uiHits++;until=Date.now()+2500;setTimeout(()=>{result.done=true;},3000);}});
const ipc=Interceptor.attach(m.base.add(0x3401f20),{onEnter(args){if(Date.now()>until||result.packets.length>=20)return;const size=args[2].toUInt32();if(size<1||size>65536)return;try{
 const data=new Uint8Array(args[1].readByteArray(size)),marker=contains(data,c.marker)||contains(data,c.wideMarker);
 const record={length:size,testMarkerFound:marker};
 if(marker){record.targetIdFound=contains(data,c.target);const known=['message::send_text_message','send_text_message','input_box_msg_send','SendMsgRequestNew','send_message'];record.recognizedRoutes=known.filter(s=>contains(data,Array.from(s,x=>x.charCodeAt(0))));}
 result.packets.push(record);
 }catch{result.packets.push({length:size,readable:false});}}});
rpc.exports={snapshot(){return result;},dispose(){ui.detach();ipc.detach();}};
send({event:'ipc-observer-ready',readsOnlyBoundedSendBuffers:true,storesRawPackets:false,canSend:false});
'''.replace('CONFIG',json.dumps(profile))
session=frida.attach(meta['pid']);script=session.create_script(agent);script.on('message',lambda m,d:print(json.dumps(m),flush=True))
try:
 script.load()
 for _ in range(60):
  time.sleep(1);r=script.exports_sync.snapshot()
  if r['done']:break
 with open('data/research/native/ipc-observation.json','w') as f:json.dump(r,f,indent=2)
 print(json.dumps(r),flush=True)
finally:
 try:script.exports_sync.dispose();script.unload()
 finally:session.detach()
