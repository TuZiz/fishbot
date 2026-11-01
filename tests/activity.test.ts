import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalActivity,type ActivityEvent} from '../src/monitoring/activity.js';
import {Store,scopeOf} from '../src/storage/store.js';
import {Delivery} from '../src/core/delivery.js';
import {MockAdapter} from '../src/adapters/mock/adapter.js';
import {incomingSchema} from '../src/schema.js';
import {SettingsRepository} from '../src/config/settings.js';
import {ConversationEngine} from '../src/conversation/engine.js';

test('terminal activity bounds untrusted text, hides credentials and never prints image paths',()=>{
 const lines:string[]=[],logger=new TerminalActivity(line=>lines.push(line),['known-management-token']);
 logger.setNames([['group','测试群']]);
 logger.emit({stage:'received',scope:'["group","group"]',sender:'成员\n伪造行',text:'hello\u001b\n sk-1234567890 known-management-token '+ 'a'.repeat(64)+'!'});
 logger.emit({stage:'sending',scope:'["group","group"]',kind:'image',text:'C:/private/image.png'});
 assert.match(lines[0]!,/收到消息.*测试群.*hello/);
 assert.doesNotMatch(lines[0]!,/[\r\n\u001b]|sk-1234567890|known-management-token|a{64}/);
 assert.match(lines[1]!,/\[图片\]/);assert.doesNotMatch(lines[1]!,/private/);
 const hidden:string[]=[];new TerminalActivity(line=>hidden.push(line),[],false).emit({stage:'sending',scope:'["private","friend"]',text:'private body'});
 assert.doesNotMatch(hidden[0]!,/private body/);
});

test('delivery activity distinguishes dry-run, confirmed success and ambiguous failure without resending',async()=>{
 for(const mode of ['dry','success','unknown'] as const){
  const store=new Store(':memory:'),adapter=new MockAdapter();await adapter.connect();
  if(mode==='unknown')adapter.sendText=async()=>{throw new Error('transport failed');};
  const message=incomingSchema.parse({id:'event-'+mode,conversationId:'friend',kind:'private',senderId:'friend',text:'synthetic input',timestamp:Date.now()});
  store.enqueue(message,'synthetic output');
  const delivery=new Delivery(store,adapter,mode==='dry',new Set([scopeOf(message)]));
  const events:ActivityEvent[]=[];delivery.activity=e=>events.push(e);
  try{
   await delivery.flush();await delivery.flush();
   assert.deepEqual(events.map(e=>e.stage),mode==='dry'?['dry-run']:['sending',mode==='success'?'sent':'unknown']);
   if(mode==='success')assert.match(events[1]!.messageId!,/^mock:/);
   assert.equal(adapter.sent.length,mode==='success'?1:0);
  }finally{await delivery.close();await adapter.disconnect();store.close();}
 }
});

test('received activity deduplicates, ignores self messages and shows session pause',async()=>{
 const store=new Store(':memory:'),settings=new SettingsRepository(store),adapter=new MockAdapter();
 settings.save({...settings.get(),allConversations:true});
 const delivery=new Delivery(store,adapter,true,new Set());
 const engine=new ConversationEngine(store,settings,{complete:async()=>{throw Error('must not call AI');}},delivery,()=>{});
 const events:ActivityEvent[]=[];engine.activity=e=>events.push(e);
 const message=incomingSchema.parse({id:'pause-event',conversationId:'friend',kind:'private',senderId:'friend',text:'停止回复',timestamp:Date.now()});
 try{
  assert.equal(engine.receive(message),true);assert.equal(engine.receive(message),false);
  assert.equal(engine.receive({...message,id:'self',isSelf:true}),false);
  assert.deepEqual(events.map(e=>e.stage),['received','skipped']);
 }finally{await engine.close();await delivery.close();store.close();}
});
