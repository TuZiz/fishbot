// Consumes raw decoder bytes over a private child pipe; prints only size/format/checksum result.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const stage=resolve(process.argv[2]);
const {normalizeCachedImage}=await import(pathToFileURL(resolve(stage,'dist/images/cached-format.js')).href);
const root='C:/wx/tools/fishbot-frida-research-17.25.0';
const {stdout}=await promisify(execFile)('C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe',[root+'/probe-image-read.py','--root',root,'--dependencies',root,'--input-json','C:/wx/fishbot/data/research/images/received-image-probe-private.json','--reader-module','--json-bytes'],{windowsHide:true,maxBuffer:29_000_000,timeout:15000});
const decoded=JSON.parse(stdout);if(!decoded.matchesExpectedMD5)throw Error('Test image identity mismatch');
const raw=Buffer.from(decoded.base64,'base64');
console.log(JSON.stringify({containerHeaderLength:raw.readUInt16LE(4),layerField:raw.readUInt16LE(6),widthField:raw.readUInt16LE(8),heightField:raw.readUInt16LE(10)}));
const nals=[];for(let i=6;i+4<raw.length;i++)if(raw[i]===0&&raw[i+1]===0&&raw[i+2]===1){nals.push({offset:i,type:raw[i+3]>>1&63});i+=2;}
console.log(JSON.stringify({streamStarts:nals.filter(v=>v.type===32).map(v=>v.offset),nalTypes:nals.slice(0,15).map(v=>v.type)}));
const image=await normalizeCachedImage(raw,'C:/wx/tools/imageio-ffmpeg-0.6.0/ffmpeg-win-x86_64-v7.1.exe',AbortSignal.timeout(20000));
if(!image)throw Error('Production conversion rejected');
const report={at:new Date().toISOString(),sourceFormat:decoded.format,sourceBytes:decoded.decoderReturnedBytes,md5Matches:true,outputMime:image.mime,outputBytes:image.bytes.length,width:image.bytes.readUInt32BE(16),height:image.bytes.readUInt32BE(20),imageSaved:false,keyExported:false};
await writeFile('data/research/images/received-photo-conversion.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
