// Private binary stdin only. Reports dimensions, never image content or paths.
import {normalizeCachedImage} from '../dist/images/cached-format.js';
const chunks=[];let size=0;
for await(const chunk of process.stdin){size+=chunk.length;if(size>20*1024*1024)throw Error('Photo too large');chunks.push(chunk);}
const image=await normalizeCachedImage(Buffer.concat(chunks),'C:/wx/tools/imageio-ffmpeg-0.6.0/ffmpeg-win-x86_64-v7.1.exe',AbortSignal.timeout(20000));
if(!image)throw Error('Downloaded photo format invalid');
// WXGF converts to PNG; direct JPEG/WebP remain accepted by the same resolver.
const png=image.mime==='image/png'&&image.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
console.log(JSON.stringify({valid:true,mime:image.mime,bytes:image.bytes.length,...(png?{width:image.bytes.readUInt32BE(16),height:image.bytes.readUInt32BE(20)}:{})}));
