/** Extract the colour HEVC stream, excluding the preceding alpha stream in two-layer WXGF.
 * Verified with the cloud client's one-stream photo and two-stream opaque/alpha photo caches.
 */
export function wxgfColourStream(bytes:Buffer):Buffer {
  if(bytes.length<20||bytes.toString('ascii',0,4)!=='wxgf')throw Error('Unsupported WXGF header');
  const header=bytes.readUInt16LE(4);
  if(![19,20].includes(header))throw Error('Unsupported WXGF header');
  // Header 19 (one colour stream) uses a different bit-packed layout. Do not
  // interpret its offsets as the header-20 width/layer fields.
  const layers=header===19?1:bytes.readUInt16LE(6);
  if(![1,2].includes(layers))throw Error('Unsupported WXGF layout');
  const nals:{offset:number;type:number}[]=[];
  for(let i=20;i+4<bytes.length;i++){
    if(bytes[i]===0&&bytes[i+1]===0&&bytes[i+2]===1){
      nals.push({offset:i>20&&bytes[i-1]===0?i-1:i,type:(bytes[i+3]!>>1)&63});i+=2;
    }
  }
  const streams=nals.flatMap((nal,index)=>nal.type===32?[index]:[]);
  if(streams.length!==layers)throw Error('WXGF stream count mismatch');
  for(const [position,start] of streams.entries()){
    const end=streams[position+1]??nals.length,types=nals.slice(start,end).map(v=>v.type);
    if(types[0]!==32||types[1]!==33||types[2]!==34||!types.some(type=>type<=31))throw Error('WXGF colour stream unavailable');
  }
  // The two-layer cache places opacity first and the photograph second. Passing
  // the whole container to FFmpeg decodes that opacity plane as a white image.
  return bytes.subarray(nals[streams.at(-1)!]!.offset);
}
