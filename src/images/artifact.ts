import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_IMAGE_BYTES=20*1024*1024;
export async function boundedBody(response:Response,limit:number):Promise<Buffer> {
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Image response exceeds size limit');}
  if(!response.body)throw Error('Image response is empty');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Image response exceeds size limit');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
export async function saveImage(bytes:Buffer,directory:string,signal:AbortSignal):Promise<string> {
  if(bytes.length>MAX_IMAGE_BYTES)throw Error('Image exceeds 20 MiB limit');
  const extension=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes[0]===255&&bytes[1]===216?'jpg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
  if(!extension)throw Error('Image response is not PNG/JPEG/WebP');
  signal.throwIfAborted();await mkdir(directory,{recursive:true});
  const path=resolve(join(directory,`${randomUUID()}.${extension}`)),temp=path+'.tmp';
  try{await writeFile(temp,bytes,{flag:'wx'});signal.throwIfAborted();await rename(temp,path);}catch(error){await unlink(temp).catch(()=>{});throw error;}
  return path;
}
// Only explicitly trusted origins are allowed, including every redirect. No API credentials
// accompany media requests. Operators add a provider's CDN origin after verifying it.
export async function downloadImage(url:string,origins:Set<string>,fetcher:typeof fetch,signal:AbortSignal):Promise<Buffer> {
  let current=url;
  for(let redirects=0;redirects<=3;redirects++){
    let parsed:URL;try{parsed=new URL(current);}catch{throw Error('Invalid image download URL');}
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||!origins.has(parsed.origin))throw Error('Image download origin is not trusted');
    const response=await fetcher(parsed.href,{signal,redirect:'manual'});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');await response.body?.cancel();
      if(!location)throw Error('Image redirect has no location');current=new URL(location,parsed).href;continue;
    }
    if(!response.ok){await response.body?.cancel();throw Error(`Image download HTTP ${response.status}`);}
    return boundedBody(response,MAX_IMAGE_BYTES);
  }
  throw Error('Too many image download redirects');
}
