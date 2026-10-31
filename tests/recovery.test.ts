import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/storage/migrations.js';
import { Store,scopeOf } from '../src/storage/store.js';
import { Delivery } from '../src/core/delivery.js';
import { MockAdapter } from '../src/adapters/mock/adapter.js';
import { incomingSchema } from '../src/schema.js';
import { MemoryRepository } from '../src/memory/repository.js';
import { settingsSchema } from '../src/config/settings.js';
test('idempotent migration preserves v1 outbox and rejects future schemas',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE outbox(id INTEGER PRIMARY KEY,scope TEXT,incoming TEXT,target TEXT,text TEXT,status TEXT,result TEXT);INSERT INTO outbox VALUES(1,'s','i','t','preserve','pending',NULL);PRAGMA user_version=1");
 migrate(db);migrate(db);assert.equal(db.prepare('SELECT text FROM outbox').get()!.text,'preserve');assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,3);db.exec('PRAGMA user_version=99');assert.throws(()=>migrate(db));db.close();
});
test('known not-sent retries at most three times; unknown is not retried',async()=>{
 const s=new Store(':memory:');const a=new MockAdapter();const m=incomingSchema.parse({id:'1',kind:'private',conversationId:'p',senderId:'u',text:'hello',timestamp:Date.now()});s.enqueue(m,'reply');const d=new Delivery(s,a,false,new Set([scopeOf(m)]));
 for(let n=0;n<3;n++){s.db.prepare('UPDATE outbox SET next_at=0').run();await d.flush();}
 assert.equal(s.pending().length,0);assert.equal(s.db.prepare('SELECT status,attempts FROM outbox').get()!.status,'not-sent');assert.equal(s.db.prepare('SELECT attempts FROM outbox').get()!.attempts,3);s.close();
});
test('automatic extraction validates source and scope, forget prevents re-extraction',async()=>{
 const s=new Store(':memory:'),r=new MemoryRepository(s);const scope='["private","p"]';const m=incomingSchema.parse({id:'m',kind:'private',conversationId:'p',senderId:'u',text:'我喜欢钓鱼',timestamp:Date.now()});let count=0;
 const model={async complete(){count++;return JSON.stringify({summary:'聊了钓鱼',facts:[{subject:'u',key:'兴趣',value:'钓鱼',sourceId:'m',quote:'喜欢钓鱼'},{subject:'other',key:'兴趣',value:'游泳',sourceId:'m',quote:'喜欢钓鱼'}]});}};
 await r.extract(scope,[m],model,settingsSchema.parse({}),new AbortController().signal);assert.equal(r.list(scope).length,1);assert.equal(r.context('["group","p"]').summary,null);assert.ok(r.context(scope).summary);r.forget(scope);await r.extract(scope,[m],model,settingsSchema.parse({}),new AbortController().signal);assert.equal(count,1);assert.equal(r.list(scope).length,0);s.close();
});
