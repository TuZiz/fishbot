import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadOnlyDatabaseAdapter } from '../src/adapters/wechat/database/read-only-adapter.js';

test('empty and invalid scopes stop database observation instead of retaining old targets',async()=>{
 const watched:string[][]=[];
 const observer={
  sessions:[{id:'friend-a',kind:'private',name:'A'}],
  status:{running:true,error:null as string|null,baselineIds:[] as string[]},
  start(){},onMessage(){return ()=>{}},watch(ids:string[]){watched.push([...ids]);this.status.baselineIds=[...ids];},
  async close(){},
 };
 const adapter=new ReadOnlyDatabaseAdapter(observer as never,['friend-a']);
 await adapter.connect();
 await adapter.setScopes([]);
 assert.deepEqual(watched.at(-1),[]);
 await assert.rejects(adapter.setScopes(['friend-a','unknown']),/unknown cloud conversation/);
 assert.deepEqual(watched.at(-1),[]);
 await adapter.disconnect();
});
