import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DeepSeekClient } from '../src/ai/client.js';
import { Store,scopeOf } from '../src/storage/store.js';
import { SettingsRepository } from '../src/config/settings.js';
import { MockAdapter } from '../src/adapters/mock/adapter.js';
import { Delivery } from '../src/core/delivery.js';
import { ConversationEngine } from '../src/conversation/engine.js';
import { incomingSchema } from '../src/schema.js';
test('HTTP client retries 429, sends validated parameters and collects usage',async()=>{
 let calls=0;const usage:unknown[]=[];
 const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{const input=JSON.parse(body);assert.equal(input.model,'test-model');assert.equal(req.headers.authorization,'Bearer test');calls++;if(calls===1){res.writeHead(429);res.end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'吃饭了没'},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const address=server.address() as {port:number};const c=new DeepSeekClient('test',v=>usage.push(v),{url:`http://127.0.0.1:${address.port}`,timeoutMs:1000,retries:1,minIntervalMs:0});assert.equal(await c.complete({system:'test',input:'hi',model:'test-model',temperature:1,maxTokens:100}),'吃饭了没');assert.equal(calls,2);assert.equal(usage.length,1);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test('private messages merge, preserve history, cancel stale generation, isolate conversations',async()=>{
 const store=new Store(':memory:');const settings=new SettingsRepository(store,{mergeMs:10,whitelist:[['private','a'],['private','b']]});const a=new MockAdapter();await a.connect();
 const inputs:string[]=[];const e=new ConversationEngine(store,settings,{async complete(r){inputs.push(r.input);return JSON.stringify({text:'鱼来了'});}},new Delivery(store,a,false,new Set(['["private","a"]','["private","b"]'])),err=>{throw err;});
 const m=incomingSchema.parse({id:'1',kind:'private',conversationId:'a',senderId:'u',text:'吃饭',timestamp:Date.now()});
 e.receive(m);e.receive({...m,id:'2',text:'了吗'});await e.idle();assert.equal(inputs.length,1);assert.equal(a.sent.length,1);assert.match(inputs[0]!,/吃饭/);assert.match(inputs[0]!,/了吗/);
 e.receive({...m,id:'3',conversationId:'b',text:'other'});await e.idle();assert.doesNotMatch(inputs[1]!,/吃饭/);e.receive({...m,id:'4',text:'停止回复'});await e.idle();assert.equal(a.sent.length,2);await e.close();store.close();
});
test('API timeouts and authorization failures propagate with bounded retry',async()=>{
 let calls=0;
 const server=createServer((_req,res)=>{calls++;res.writeHead(401);res.end();});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;
 const req={system:'s',input:'u',model:'test',temperature:1,maxTokens:100};
 try{const c=new DeepSeekClient('test',()=>{},{url:`http://127.0.0.1:${port}`,timeoutMs:100,retries:2,minIntervalMs:0});await assert.rejects(c.complete(req),/HTTP 401/);assert.equal(calls,1);}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 const slow=createServer(()=>{});await new Promise<void>(r=>slow.listen(0,'127.0.0.1',r));
 try{const c=new DeepSeekClient('test',()=>{},{url:`http://127.0.0.1:${(slow.address() as {port:number}).port}`,timeoutMs:30,retries:0,minIntervalMs:0});await assert.rejects(c.complete(req));}finally{slow.closeAllConnections();await new Promise<void>(r=>slow.close(()=>r()));}
});


