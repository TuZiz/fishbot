import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAdapter } from '../src/adapters/mock/adapter.js';
import { Store, scopeOf } from '../src/storage/store.js';
import { Delivery } from '../src/core/delivery.js';
import { incomingSchema } from '../src/schema.js';
const message=()=>incomingSchema.parse({id:'m1',kind:'private',conversationId:'test',senderId:'u1',text:'你好',timestamp:Date.now()});
test('mock receive validation, connection and sends',async()=>{
 const a=new MockAdapter(); assert.throws(()=>a.receive(message()));await a.connect();
 let count=0;a.onMessage(()=>count++);a.receive(message());assert.equal(count,1);
 assert.throws(()=>a.receive({}));assert.equal((await a.sendText('test','hello')).status,'sent');
 await assert.rejects(a.sendImage('test','missing-image.png'));await a.disconnect();
 assert.equal((await a.sendText('test','hello')).status,'not-sent');
});
test('dedup scoped by kind; dry-run never invokes adapter',async()=>{
 const s=new Store(':memory:');const m=message();assert.equal(s.accept(m),true);assert.equal(s.accept(m),false);
 assert.equal(s.accept({...m,kind:'group'}),true);s.enqueue(m,'hello');s.enqueue(m,'hello');
 const a=new MockAdapter();await a.connect();await new Delivery(s,a,true,new Set([scopeOf(m)])).flush();
 assert.equal(a.sent.length,0);assert.equal(s.pending().length,0);s.close();
});
test('whitelist, pause and concurrent drains prevent duplicate send',async()=>{
 const s=new Store(':memory:');const m=message();s.enqueue(m,'hi');const a=new MockAdapter();await a.connect();
 const allowed=new Set<string>();const d=new Delivery(s,a,false,allowed);await d.flush();assert.equal(a.sent.length,0);
 allowed.add(scopeOf(m));d.paused=true;await d.flush();assert.equal(a.sent.length,0);
 d.paused=false;await Promise.all([d.flush(),d.flush()]);assert.equal(a.sent.length,1);s.close();
});
test('ambiguous send is never retried',async()=>{
 const s=new Store(':memory:');const m=message();s.enqueue(m,'hi');const a=new MockAdapter();
 a.sendText=async()=>{throw new Error('timeout after send');};const d=new Delivery(s,a,false,new Set([scopeOf(m)]));
 await d.flush();assert.equal(s.pending().length,0);
 assert.equal((s.db.prepare('SELECT status FROM outbox').get() as {status:string}).status,'unknown');s.close();
});
test('reopen recovers in-flight jobs as unknown and retains pending',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fishbot-'));try{
 const path=join(dir,'state.sqlite');let s=new Store(path);s.enqueue(message(),'hello');const id=s.pending()[0]!.id;s.claim(id);s.close();
 s=new Store(path);assert.equal(s.pending().length,0);assert.equal((s.db.prepare('SELECT status FROM outbox').get() as {status:string}).status,'unknown');s.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
