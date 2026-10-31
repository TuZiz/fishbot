import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/storage/store.js';
import { SettingsRepository } from '../src/config/settings.js';
import { ConversationEngine } from '../src/conversation/engine.js';
import { Delivery } from '../src/core/delivery.js';
import { MockAdapter } from '../src/adapters/mock/adapter.js';
import { incomingSchema } from '../src/schema.js';
test('new message cancels late response even if model ignores abort',async()=>{
 const store=new Store(':memory:'),s=new SettingsRepository(store,{mergeMs:10,whitelist:[['private','a']]});const a=new MockAdapter();await a.connect();let resolveFirst!:(v:string)=>void;let started!:()=>void;const ready=new Promise<void>(r=>started=r);let calls=0;
 const engine=new ConversationEngine(store,s,{async complete(){if(++calls===1){started();return new Promise<string>(r=>resolveFirst=r);}return JSON.stringify({text:'new reply'});}},new Delivery(store,a,false,new Set(['["private","a"]'])),err=>{throw err;});
 try{const m=incomingSchema.parse({id:'1',conversationId:'a',kind:'private',senderId:'u',text:'old',timestamp:Date.now()});engine.receive(m);await ready;engine.receive({...m,id:'2',text:'new'});resolveFirst(JSON.stringify({text:'old reply'}));await engine.idle();assert.equal(a.sent.length,1);assert.equal(a.sent[0]!.content,'new reply');}finally{await engine.close();store.close();}
});

test('startup recovers a persisted unprocessed message once',async()=>{
 const store=new Store(':memory:'),settings=new SettingsRepository(store,{mergeMs:10,whitelist:[['private','a']]});const adapter=new MockAdapter();await adapter.connect();
 const m=incomingSchema.parse({id:'recover',kind:'private',conversationId:'a',senderId:'u',text:'刚才断线了',timestamp:Date.now()});store.accept(m);let calls=0;
 const engine=new ConversationEngine(store,settings,{async complete(){calls++;return JSON.stringify({text:'接上了'});}},new Delivery(store,adapter,false,new Set(['["private","a"]'])),err=>{throw err;});
 try{engine.recover();await engine.idle();assert.equal(adapter.sent.length,1);engine.recover();await engine.idle();assert.equal(calls,1);}finally{await engine.close();store.close();}
});
