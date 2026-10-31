import {open,readFile,stat} from 'node:fs/promises';
import {detectKeys,decryptPage,PAGE_SIZE,type PageKeys} from './crypto.js';
function checksum(bytes:Buffer,little:boolean,start:[number,number]=[0,0]):[number,number]{
  let [a,b]=start;
  for(let i=0;i<bytes.length;i+=8){a=(a+(little?bytes.readUInt32LE(i):bytes.readUInt32BE(i))+b)>>>0;b=(b+(little?bytes.readUInt32LE(i+4):bytes.readUInt32BE(i+4))+a)>>>0;}
  return [a,b];
}
export function committedWal(wal:Buffer){
  if(wal.length===0)return [];
  if(wal.length<32)throw new Error('Incomplete WAL header');
  const magic=wal.readUInt32BE(0),little=magic===0x377f0682;
  if(!little&&magic!==0x377f0683)throw new Error('Unsupported WAL magic');
  if(wal.readUInt32BE(8)!==PAGE_SIZE)throw new Error('Unsupported WAL page size');
  let sum=checksum(wal.subarray(0,24),little);
  if(sum[0]!==wal.readUInt32BE(24)||sum[1]!==wal.readUInt32BE(28))throw new Error('WAL header checksum mismatch');
  const frames:{page:number;data:Buffer;size:number}[]=[];let committed=0;
  for(let offset=32;offset+24+PAGE_SIZE<=wal.length;offset+=24+PAGE_SIZE){
    const header=wal.subarray(offset,offset+24),data=wal.subarray(offset+24,offset+24+PAGE_SIZE);
    // Preallocated WAL may contain old frames beyond the current writer's valid prefix.
    if(!header.subarray(8,16).equals(wal.subarray(16,24)))break;
    const next=checksum(data,little,checksum(header.subarray(0,8),little,sum));
    if(next[0]!==header.readUInt32BE(16)||next[1]!==header.readUInt32BE(20))break;
    const page=header.readUInt32BE(0);if(page<1)throw new Error('Invalid WAL page number');
    sum=next;const size=header.readUInt32BE(4);frames.push({page,data,size});if(size)committed=frames.length;
  }
  return frames.slice(0,committed);
}
export async function snapshotDatabase(source:string,destination:string,key:string){
  const before=await stat(source);if(before.size>512*1024*1024||before.size%PAGE_SIZE)throw new Error('Unsupported database size');
  const walBefore=await stat(source+'-wal').catch(()=>null);
  if(walBefore&&walBefore.size>64*1024*1024)throw new Error('WAL exceeds snapshot limit');
  const input=await open(source,'r');const output=await open(destination,'wx');let keys:PageKeys|undefined;
  try{
    for(let offset=0;offset<before.size;offset+=PAGE_SIZE){const page=Buffer.alloc(PAGE_SIZE);const r=await input.read(page,0,PAGE_SIZE,offset);if(r.bytesRead!==PAGE_SIZE)throw new Error('Database changed during snapshot');keys??=await detectKeys(page,key);await output.write(decryptPage(page,offset/PAGE_SIZE+1,keys),0,PAGE_SIZE,offset);}
    if(walBefore?.size){const wal=await readFile(source+'-wal');for(const frame of committedWal(wal)){await output.write(decryptPage(frame.data,frame.page,keys!),0,PAGE_SIZE,(frame.page-1)*PAGE_SIZE);if(frame.size)await output.truncate(frame.size*PAGE_SIZE);}}
    const after=await stat(source),walAfter=await stat(source+'-wal').catch(()=>null);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||walBefore?.size!==walAfter?.size||walBefore?.mtimeMs!==walAfter?.mtimeMs)throw new Error('Source changed during snapshot; retry later');
  }finally{await input.close();await output.close();}
}
