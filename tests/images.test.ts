import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ImageClient} from '../src/images/client.js';
import {imageIntent} from '../src/images/intent.js';
import {createApplication} from '../src/core/application.js';
import {environmentSchema} from '../src/config/environment.js';
const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
test('explicit image intents and quoted image editing',()=>{
 for(const text of ['生图 海边的猫','画一张海边的猫','帮我生成一张图片：海边的猫'])assert.ok(imageIntent(text));
 assert.equal(imageIntent('美化引用的图片，增加光照')?.edit,true);
 assert.equal(imageIntent('你觉得生图好用吗'),null);
});
test('image client switches only on definitive rejection and writes bytes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fishbot-image-'));let calls=0;
 try{const client=new ImageClient([{url:'https://primary/v1',key:'secret1',model:'flare'},{url:'https://backup/v1',key:'secret2',model:'sunburst'}],dir,async(url,init)=>{calls++;assert.ok(init?.signal);if(calls===1)return new Response('',{status:429});assert.equal(url,'https://backup/v1/images/generations');return Response.json({data:[{b64_json:png.toString('base64')}]});});
 const path=await client.generate({prompt:'cat'},new AbortController().signal);assert.deepEqual(await readFile(path),png);assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('ambiguous provider failures never retry or leak response bodies',async()=>{
 let calls=0;const client=new ImageClient([{url:'https://a/v1',key:'s',model:'m'},{url:'https://b/v1',key:'s',model:'m'}],undefined,async()=>{calls++;return new Response('private upstream message',{status:500});});
 await assert.rejects(client.generate({prompt:'cat'},new AbortController().signal),/^Error: Image HTTP 500$/);assert.equal(calls,1);
});
test('editing sends the exact reference bytes to edits with explicit subject preservation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fishbot-edit-upload-'));let called=false;
 try{
  const client=new ImageClient([{url:'https://backup/v1',key:'secret',model:'sunburst'}],dir,async(url,init)=>{
   called=true;assert.equal(url,'https://backup/v1/images/edits');const form=init!.body as FormData;
   assert.match(String(form.get('prompt')),/保留原图主体/);assert.match(String(form.get('prompt')),/背景改成夕阳/);
   const file=form.get('image') as Blob;assert.equal(file.type,'image/png');assert.deepEqual(Buffer.from(await file.arrayBuffer()),png);
   return Response.json({data:[{b64_json:png.toString('base64')}]});
  });
  await client.generate({prompt:'背景改成夕阳',reference:{bytes:png,mime:'image/png'}},new AbortController().signal);assert.equal(called,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('image connection diagnostics expose only a known network code and never retry',async()=>{
 let calls=0;const client=new ImageClient([{url:'https://a/v1',key:'secret',model:'m'},{url:'https://b/v1',key:'secret',model:'m'}],undefined,async()=>{calls++;throw new TypeError('private upstream token',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});});
 await assert.rejects(client.generate({prompt:'cat'},new AbortController().signal),/^Error: Image network UND_ERR_CONNECT_TIMEOUT$/);assert.equal(calls,1);
});
test('chat image workflow uses delivery; unsupported transport never spends',async()=>{
 const r=await createApplication(environmentSchema.parse({INGEST_TOKEN:'image-test-token-long-enough',DB_PATH:':memory:',TEST_SCOPES:'[["private","p"]]',DRY_RUN:'false'}),{async complete(){throw Error('text model must not handle explicit image request');}});
 const dir=await mkdtemp(join(tmpdir(),'fishbot-chat-'));let calls=0;
 r.settings.save({...r.settings.get(),mergeMs:10});r.engine.imageGenerator={async generate(){calls++;return join(dir,'test.png');}};
 try{r.engine.canSendImages=false;r.adapter.receive({id:'1',kind:'private',conversationId:'p',senderId:'u',text:'画一张猫',timestamp:Date.now()});await r.engine.idle();assert.equal(calls,0);assert.match(r.adapter.sent[0]!.content,/尚未支持图片发送/);
 const {writeFile}=await import('node:fs/promises');await writeFile(join(dir,'test.png'),png);r.engine.canSendImages=true;r.adapter.receive({id:'2',kind:'private',conversationId:'p',senderId:'u',text:'生图 猫',timestamp:Date.now()});await r.engine.idle();assert.equal(calls,1);assert.match(r.adapter.sent[1]!.content,/稍等/);assert.equal(r.adapter.sent[2]!.kind,'image');
 r.adapter.receive({id:'3',kind:'private',conversationId:'p',senderId:'u',text:'美化引用的图片',timestamp:Date.now()});await r.engine.idle();assert.equal(calls,1);assert.match(r.adapter.sent[3]!.content,/请引用一张图片/);
 }finally{await r.app.close();await rm(dir,{recursive:true,force:true});}
});
