import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCachedImage} from '../src/images/cached-format.js';
import {wxgfColourStream} from '../src/images/wxgf.js';
test('reference formats pass through supported images, reject unknown/unconfigured formats and respect cancellation',async()=>{
 const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
 assert.deepEqual(await normalizeCachedImage(bytes),{bytes,mime:'image/png'});
 assert.equal(await normalizeCachedImage(Buffer.from('wxgf-not-yet-converted')),undefined);
 assert.equal(await normalizeCachedImage(Buffer.from('not an image'),'unused'),undefined);
 await assert.rejects(normalizeCachedImage(bytes,undefined,AbortSignal.abort()),{name:'AbortError'});
});
test('two-layer WXGF uses colour rather than the first opacity image, ambiguous streams fail closed',()=>{
 const header=Buffer.alloc(20);header.write('wxgf');header.writeUInt16LE(20,4);header.writeUInt16LE(2,6);header.writeUInt16LE(236,8);header.writeUInt16LE(239,10);
 const nal=(type:number,data:number)=>Buffer.from([0,0,0,1,type<<1,1,data]);
 const stream=(data:number)=>Buffer.concat([nal(32,data),nal(33,data),nal(34,data),nal(19,data)]);
 const alpha=stream(255),colour=stream(70),container=Buffer.concat([header,alpha,colour]);
 assert.deepEqual(wxgfColourStream(container),colour);
 const single=Buffer.from(header);single.writeUInt16LE(1,6);assert.deepEqual(wxgfColourStream(Buffer.concat([single,colour])),colour);
 const older=Buffer.from(header);older.writeUInt16LE(19,4);older.writeUInt16LE(514,6);assert.deepEqual(wxgfColourStream(Buffer.concat([older,colour])),colour);
 assert.throws(()=>wxgfColourStream(Buffer.concat([header,alpha])),/stream count/);
 assert.throws(()=>wxgfColourStream(Buffer.concat([header,alpha,colour,colour])),/stream count/);
});
