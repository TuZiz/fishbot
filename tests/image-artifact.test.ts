import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ImageClient} from '../src/images/client.js';
import {boundedBody,downloadImage} from '../src/images/artifact.js';
import {environmentSchema} from '../src/config/environment.js';

test('media downloads reject untrusted origins and redirect targets without sending credentials',async()=>{
 let calls=0;
 const fetcher:typeof fetch=async(_url,init)=>{calls++;assert.equal(init?.headers,undefined);return new Response(null,{status:302,headers:{location:'https://untrusted/image.png'}});};
 const signal=new AbortController().signal;
 await assert.rejects(downloadImage('http://trusted/image.png',new Set(['https://trusted']),fetcher,signal),/not trusted/);assert.equal(calls,0);
 await assert.rejects(downloadImage('https://trusted/image.png',new Set(['https://trusted']),fetcher,signal),/not trusted/);assert.equal(calls,1);
 await assert.rejects(downloadImage('https://user:password@trusted/image.png',new Set(['https://trusted']),fetcher,signal),/not trusted/);assert.equal(calls,1);
});
test('body limits apply to declared and streamed data',async()=>{
 await assert.rejects(boundedBody(new Response('x',{headers:{'content-length':'11'}}),10),/size limit/);
 await assert.rejects(boundedBody(new Response('12345678901'),10),/size limit/);
 assert.equal((await boundedBody(new Response('123'),10)).toString(),'123');
});
test('URL-only generation downloads trusted bytes into a durable file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fishbot-url-image-'));const png=Buffer.from([137,80,78,71,13,10,26,10]);let calls=0;
 try{
 const client=new ImageClient([{url:'https://api.example/v1',model:'m',key:'secret'}],dir,async(url,init)=>{
  calls++;if(calls===1)return Response.json({data:[{url:'https://cdn.example/image.png'}]});
  assert.equal(url,'https://cdn.example/image.png');assert.equal(init?.headers,undefined);return new Response(png);
 },{downloadOrigins:['https://cdn.example']});
 assert.deepEqual(await readFile(await client.generate({prompt:'cat'},new AbortController().signal)),png);assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('reference edit uses multipart with image MIME and configured model',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fishbot-edit-'));const png=Buffer.from([137,80,78,71,13,10,26,10]);
 try{
 const client=new ImageClient([{url:'https://api.example/v1',model:'sunburst',key:'secret'}],dir,async(url,init)=>{
  assert.equal(url,'https://api.example/v1/images/edits');const body=init?.body as FormData;assert.equal(body.get('model'),'sunburst');assert.equal((body.get('image') as Blob).type,'image/png');return Response.json({data:[{b64_json:png.toString('base64')}]});
 });
 assert.deepEqual(await readFile(await client.generate({prompt:'green',reference:{bytes:png,mime:'image/png'}},new AbortController().signal)),png);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('image environment rejects unsafe origins and invalid deadlines',()=>{
 const base={INGEST_TOKEN:'image-artifact-test-token-long-enough'};
 for(const IMAGE_DOWNLOAD_ORIGINS of ['http://cdn.example','https://cdn.example/path','https://user:password@cdn.example'])assert.equal(environmentSchema.safeParse({...base,IMAGE_DOWNLOAD_ORIGINS}).success,false);
 assert.equal(environmentSchema.safeParse({...base,IMAGE_TIMEOUT_MS:600001}).success,false);
 assert.deepEqual(environmentSchema.parse({...base,IMAGE_DOWNLOAD_ORIGINS:'https://cdn.example'}).IMAGE_DOWNLOAD_ORIGINS,['https://cdn.example']);
});
