"""Offline 4.1.15.56 image download evidence. Never attaches or calls WeChat."""
import argparse,bisect,hashlib,json,re,struct,sys
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--dll',required=True);p.add_argument('--dependencies',required=True);p.add_argument('--output',required=True)
p.add_argument('--function',action='append',default=[],help='Additional RVA to inspect and find direct callers (offline only)')
p.add_argument('--summary',action='store_true',help='Print counts only; full evidence is still written to anchors.json')
p.add_argument('--address',action='append',default=[],help='Additional exact data RVA to find references to (for example an offline vtable)')
args=p.parse_args();sys.path.insert(0,args.dependencies)
import pefile
raw=Path(args.dll).read_bytes()
if hashlib.sha256(raw).hexdigest()!='e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556':raise RuntimeError('Unsupported DLL fingerprint')
pe=pefile.PE(data=raw,fast_load=True)
entry=pe.OPTIONAL_HEADER.DATA_DIRECTORY[3]
functions=sorted((a,b) for a,b,c in struct.iter_unpack('<III',pe.get_data(entry.VirtualAddress,entry.Size)) if a<b)
starts=[a for a,b in functions]
def enclosing(rva):
 i=bisect.bisect_right(starts,rva)-1
 return functions[i] if i>=0 and rva<functions[i][1] else None
pattern=re.compile(rb'[ -~]{8,240}')
anchors=[]
for match in pattern.finditer(raw):
 text=match.group().decode()
 if any(s.lower() in text.lower() for s in ['MessageImageResource','GetAvailableImageSync','ImageDownloadTask','CreateC2CImageDownloadTask','download img','download_image','downloadimage','DownloadOriginal','DownloadOrigin','getmsgimg']):
  anchors.append({'rva':pe.get_rva_from_offset(match.start()),'text':text})
targets={a['rva']+offset:a['text'] for a in anchors for offset in range(min(65,len(a['text'])))};references=[];indirect=[]
targets.update({int(v,16):'explicit data RVA '+v for v in args.address})
for anchor in anchors:
 pointer=struct.pack('<Q',pe.OPTIONAL_HEADER.ImageBase+anchor['rva']);at=raw.find(pointer)
 while at>=0:
  rva=pe.get_rva_from_offset(at);indirect.append({'rva':hex(rva),'anchor':anchor['text']})
  for delta in range(0,65,8):targets[rva-delta]=anchor['text']+' (descriptor)'
  at=raw.find(pointer,at+8)
for section in pe.sections:
 if not section.Characteristics&0x20000000:continue
 # Some service logs copy the literal into a stack string using SIMD loads;
 # looking only for LEA silently misses their methods entirely.
 for match in re.finditer(rb'[\x40-\x4f]?(?:[\x8d\x8b]|\x0f[\x10\x28\x6f])[\x05\x0d\x15\x1d\x25\x2d\x35\x3d][\s\S]{4}',section.get_data()):
  at=section.VirtualAddress+match.start();target=at+len(match.group())+struct.unpack_from('<i',match.group(),len(match.group())-4)[0]
  if target in targets:
   function=enclosing(at)
   references.append({'anchor':targets[target],'instruction':hex(at),'function':[hex(v) for v in function] if function else None})
selected={int(v,16) for v in args.function}
selected.update(int(r['function'][0],16) for r in references if r['function'])
callers=[]
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
decoder=Cs(CS_ARCH_X86,CS_MODE_64);decoder.skipdata=True
boundaries={}
for section in pe.sections:
 if not section.Characteristics&0x20000000:continue
 for match in re.finditer(rb'[\xe8\xe9][\s\S]{4}',section.get_data()):
  at=section.VirtualAddress+match.start();target=at+5+struct.unpack_from('<i',match.group(),1)[0]
  if target not in selected:continue
  function=enclosing(at)
  if not function:continue
  if function not in boundaries:
   a,b=function
   boundaries[function]={ins.address for ins in decoder.disasm(pe.get_data(a,b-a),a) if ins.mnemonic in ('call','jmp')}
  if at not in boundaries[function]:continue
  callers.append({'target':hex(target),'instruction':hex(at),'function':[hex(v) for v in function]})
output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
report={'sha256':hashlib.sha256(raw).hexdigest(),'runtimeVerified':False,'anchors':anchors,'indirect':indirect,'references':references,'callers':callers}
(output/'anchors.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
unique=sorted({tuple(int(v,16) for v in r['function']) for r in references if r['function']})
unique=sorted(set(unique)|{enclosing(v) for v in selected if enclosing(v)}|{tuple(int(v,16) for v in r['function']) for r in callers})
(output/'targets.tsv').write_text(''.join(f'{a:x}\t{b:x}\n' for a,b in unique),encoding='utf-8')
print(json.dumps({'anchors':len(anchors),'functions':len(unique),'references':len(references) if args.summary else references,'callers':len(callers) if args.summary else callers},indent=2))
