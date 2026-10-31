import test from 'node:test';
import assert from 'node:assert/strict';
import { Participation } from '../src/group/participation.js';
import { settingsSchema } from '../src/config/settings.js';
import { incomingSchema } from '../src/schema.js';
test('AI decision uses context, cooldown and rate limits without random reply',async()=>{
 let calls=0;const p=new Participation({async complete(r){calls++;assert.match(r.input,/topic/);return JSON.stringify({shouldReply:true,replyTo:'a',reason:'被询问',replyType:'text',confidence:0.99,topic:'food'});}});
 const m=incomingSchema.parse({id:'1',kind:'group',conversationId:'g',senderId:'a',text:'鱼吃了吗',timestamp:Date.now()});const s=settingsSchema.parse({});
 assert.ok(await p.decide(m,{topic:'food'},s,new AbortController().signal));p.record(m,'food');
 assert.equal(await p.decide(m,{},s,new AbortController().signal),null);
 assert.ok(await p.decide({...m,mentionedBot:true},{topic:'food'},s,new AbortController().signal));assert.equal(calls,2);
});
