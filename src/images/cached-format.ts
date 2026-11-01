import {spawn} from 'node:child_process';
import {MAX_IMAGE_BYTES} from './artifact.js';
import {wxgfColourStream} from './wxgf.js';

function mimeOf(bytes:Buffer){
  return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':undefined;
}
/** WXGF contains HEVC: decode one still frame locally, with bounded output and lifetime. */
export async function normalizeCachedImage(bytes:Buffer,ffmpegPath?:string,signal?:AbortSignal){
  signal?.throwIfAborted();
  if(!bytes.length||bytes.length>MAX_IMAGE_BYTES)return;
  const mime=mimeOf(bytes);if(mime)return {bytes,mime};
  if(bytes.toString('ascii',0,4)!=='wxgf'||!ffmpegPath)return;
  const colour=wxgfColourStream(bytes);
  const png=await new Promise<Buffer>((resolve,reject)=>{
    const child=spawn(ffmpegPath,['-hide_banner','-loglevel','error','-nostdin','-threads','1','-f','hevc','-i','pipe:0','-frames:v','1','-vf','scale=min(2048\\,iw):min(2048\\,ih):force_original_aspect_ratio=decrease','-f','image2pipe','-vcodec','png','pipe:1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    const chunks:Buffer[]=[];let size=0,settled=false;
    const finish=(error?:unknown)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(error){child.kill();reject(error);}else resolve(Buffer.concat(chunks));
    };
    const abort=()=>finish(signal!.reason);
    const timer=setTimeout(()=>finish(Error('Image reference conversion timeout')),15000);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.once('error',()=>finish(Error('Image reference converter unavailable')));
    child.stdin.on('error',()=>finish(Error('Image reference conversion failed')));
    child.stderr.resume();
    child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>MAX_IMAGE_BYTES){finish(Error('Image reference conversion exceeds size limit'));return;}chunks.push(chunk);});
    child.once('close',code=>finish(code===0?undefined:Error('Image reference conversion failed')));
    child.stdin.end(colour);
  });
  signal?.throwIfAborted();
  if(mimeOf(png)!=='image/png'||png.length<24)throw Error('Image reference conversion failed');
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  if(!width||!height||width>2048||height>2048)throw Error('Image reference conversion exceeds dimensions');
  return {bytes:png,mime:'image/png'};
}
