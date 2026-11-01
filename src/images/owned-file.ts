import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';

/** Reads only bounded, supported media whose canonical path stays inside an owned directory. */
export async function readOwnedImage(filename:string,directory='data/generated'){
  try{
    const [path,root]=await Promise.all([realpath(filename),realpath(resolve(directory))]);
    const delta=relative(root,path);if(!delta||delta==='..'||delta.startsWith('..\\')||delta.startsWith('../')||isAbsolute(delta))return;
    const info=await stat(path);if(!info.isFile()||info.size<=0||info.size>20*1024*1024)return;
    const bytes=await readFile(path);if(bytes.length!==info.size)return;
    const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':undefined;
    return mime?{path,bytes,mime}:undefined;
  }catch{return;}
}
