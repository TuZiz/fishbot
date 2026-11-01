"""Offline PE evidence collector. No process access, injection or function invocation."""
import sys,os,json,hashlib,struct,re,bisect,argparse
from pathlib import Path
root=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root.parent/'.tools/hook-research'))
import pefile,capstone
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('source')
parser.add_argument('--output',required=True,help='Version-specific report path; never overwrite another version implicitly')
args=parser.parse_args()
source=args.source
pe=pefile.PE(source,fast_load=True)
pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_EXPORT'],pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_DEBUG']])
raw=pe.__data__
directory=pe.OPTIONAL_HEADER.DATA_DIRECTORY[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_EXCEPTION']]
functions=sorted((begin,end) for begin,end,unwind in struct.iter_unpack('<III',pe.get_data(directory.VirtualAddress,directory.Size)) if begin<end)
starts=[f[0] for f in functions]
def enclosing(rva):
 i=bisect.bisect_right(starts,rva)-1
 return functions[i] if i>=0 and rva<functions[i][1] else None
anchors={}
for name in ['TextMessageSendSource','ImageMessageSendSource','VideoMessageSendSource','message::send_text_message','send_text_message','send_text_message_failed','/cgi-bin/micromsg-bin/newsendmsg','/cgi-bin/micromsg-bin/sendmsg','NewSendMsgRequest','SendTextMsg']:
 entries=[]
 for encoding in ['ascii','utf-16-le']:
  pattern=name.encode(encoding);offset=raw.find(pattern)
  while offset>=0:
   try:entries.append({'rva':pe.get_rva_from_offset(offset),'encoding':encoding})
   except pefile.PEFormatError:pass
   offset=raw.find(pattern,offset+len(pattern))
 anchors[name]=entries
by_rva={e['rva']+delta:name+'+data:'+str(delta) for name,entries in anchors.items() for e in entries for delta in range(65)}
refs=[]
pattern=re.compile(rb'[\x48-\x4f]\x8d[\x05\x0d\x15\x1d\x25\x2d\x35\x3d][\s\S]{4}')
for section in pe.sections:
 if not section.Characteristics & 0x20000000:continue
 data=section.get_data()
 for match in pattern.finditer(data):
  at=section.VirtualAddress+match.start();target=at+7+struct.unpack_from('<i',match.group(),3)[0]
  if target in by_rva:
   function=enclosing(at)
   refs.append({'anchor':by_rva[target],'instructionRva':hex(at),'function':None if function is None else [hex(v) for v in function]})
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
functions_to_read=sorted(set(tuple(int(v,16) for v in r['function']) for r in refs if r['function']))
disassembly=[]
for begin,end in functions_to_read[:30]:
 code=pe.get_data(begin,min(end-begin,8192))
 ins=list(md.disasm(code,begin))
 disassembly.append({'begin':hex(begin),'end':hex(end),'instructions':[{'rva':hex(i.address),'bytes':i.bytes.hex(),'instruction':i.mnemonic+' '+i.op_str} for i in ins[:160]]})
exports=[{'name':e.name.decode('ascii','replace') if e.name else None,'rva':hex(e.address)} for e in getattr(getattr(pe,'DIRECTORY_ENTRY_EXPORT',None),'symbols',[])]
targets={int(r['function'][0],16) for r in refs if r['function']}
callers={target:[] for target in targets}
for section in pe.sections:
 if not section.Characteristics & 0x20000000:continue
 data=section.get_data()
 for match in re.finditer(rb'\xe8[\s\S]{4}',data):
  at=section.VirtualAddress+match.start();target=at+5+struct.unpack_from('<i',match.group(),1)[0]
  if target in callers:
   function=enclosing(at)
   callers[target].append({'callRva':hex(at),'function':None if function is None else [hex(v) for v in function]})
callReferences={hex(target):values for target,values in callers.items()}
report={'source':os.path.basename(source),'sha256':hashlib.file_digest(open(source,'rb'),'sha256').hexdigest(),'machine':hex(pe.FILE_HEADER.Machine),'imageBase':hex(pe.OPTIONAL_HEADER.ImageBase),'imageSize':pe.OPTIONAL_HEADER.SizeOfImage,'fileSize':os.path.getsize(source),'runtimeFunctionCount':len(functions),'exports':exports,'anchors':anchors,'references':refs,'callReferences':callReferences,'candidateDisassembly':disassembly,'runtimeVerified':False,'canSend':False}
output=Path(args.output)
output.parent.mkdir(parents=True,exist_ok=True)
with output.open('w',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
print(json.dumps({k:report[k] for k in ['sha256','machine','imageSize','fileSize','runtimeFunctionCount','anchors','references','callReferences','runtimeVerified','canSend']},ensure_ascii=False,indent=2))


