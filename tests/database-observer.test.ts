import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {DatabaseObserver} from '../src/adapters/wechat/database/observer.js';

class WorkerStub extends EventEmitter {
  commands:Record<string,unknown>[]=[];
  terminated=0;
  postMessage(message:Record<string,unknown>){this.commands.push(message);if(message.type==='stop')queueMicrotask(()=>this.emit('exit',0));}
  async terminate(){this.terminated++;this.emit('exit',1);return 1;}
  post(message:Record<string,unknown>){this.emit('message',message);}
}
const pause=(ms=5)=>new Promise(r=>setTimeout(r,ms));
async function until(check:()=>boolean){const end=Date.now()+1000;while(!check()){if(Date.now()>end)assert.fail('worker recovery timed out');await pause();}}

test('database worker resumes acknowledged cursors, suppresses replay, and cannot restart after close',async()=>{
  const workers:WorkerStub[]=[];
  const observer=new DatabaseObserver(()=>{const worker=new WorkerStub();workers.push(worker);return worker;},5);
  const messages:string[]=[];observer.onMessage(m=>messages.push(m.id));observer.start();observer.watch(['memo']);
  const first=workers[0]!,generation=first.commands[0]!.generation;
  const incoming={id:'9007199254740999',kind:'private',conversationId:'memo',senderId:'self',text:'synthetic test',timestamp:Date.now(),isSelf:true};
  first.post({type:'baseline',id:'memo',generation});first.post({type:'message',message:incoming,generation});
  first.post({type:'cursor',key:'message_0.db:table',value:42,generation});
  first.emit('error',Error('synthetic worker failure'));assert.equal(observer.status.running,false);
  await until(()=>workers.length===2);const second=workers[1]!;
  assert.deepEqual(second.commands[0],{type:'watch',scopes:['memo'],generation,cursors:{'message_0.db:table':42}});
  assert.deepEqual(observer.status.baselineIds,[]);
  second.post({type:'baseline',id:'memo',generation});second.post({type:'healthy',generation});
  second.post({type:'message',message:incoming,generation});
  second.post({type:'message',message:{...incoming,id:'9007199254741000'},generation});
  assert.deepEqual(messages,['9007199254740999','9007199254741000']);assert.equal(observer.status.error,null);
  assert.equal(observer.status.failureCount,1);assert.match(observer.status.lastFailure!.reason,/worker failed/);
  assert.deepEqual(observer.status.baselineIds,['memo']);assert.equal(observer.status.recoveryAttempts,1);
  await observer.close();await pause(20);assert.equal(workers.length,2);assert.equal(observer.status.running,false);
});

test('watch changes reject old generations and checkpoints, including late worker events',async()=>{
  const workers:WorkerStub[]=[];
  const observer=new DatabaseObserver(()=>{const worker=new WorkerStub();workers.push(worker);return worker;},5);
  observer.start();observer.watch(['first']);const first=workers[0]!,oldGeneration=first.commands[0]!.generation;
  observer.watch(['second']);const generation=first.commands[1]!.generation;
  first.post({type:'baseline',id:'first',generation:oldGeneration});first.post({type:'cursor',key:'old',value:9,generation:oldGeneration});
  first.post({type:'baseline',id:'outside',generation});assert.equal(observer.status.baselines,0);
  first.emit('exit',1);await until(()=>workers.length===2);
  assert.deepEqual(workers[1]!.commands[0],{type:'watch',scopes:['second'],generation,cursors:{}});
  first.post({type:'healthy',generation});assert.match(observer.status.error!,/recovery/);
  workers[1]!.post({type:'baseline',id:'second',generation});assert.deepEqual(observer.status.baselineIds,['second']);
  await observer.close();
});

test('observer shutdown during recovery cancels the pending restart',async()=>{
  let launches=0;const worker=new WorkerStub();
  const observer=new DatabaseObserver(()=>{launches++;return worker;},20);
  observer.start();worker.emit('exit',1);await observer.close();await pause(40);
  assert.equal(launches,1);assert.equal(observer.status.running,false);
});

test('pending outgoing ID checkpoints survive worker recovery and are cleared after promotion',async()=>{
 const workers:WorkerStub[]=[];
 const observer=new DatabaseObserver(()=>{const worker=new WorkerStub();workers.push(worker);return worker;},5);
 try{
  observer.start();observer.watch(['memo']);const first=workers[0]!,generation=first.commands[0]!.generation;
  first.post({type:'cursor',key:'shard:table',value:42,pendingSelf:[40],generation});first.emit('exit',1);
  await until(()=>workers.length===2);
  assert.deepEqual(workers[1]!.commands[0],{type:'watch',scopes:['memo'],generation,cursors:{'shard:table':42},pendingSelf:{'shard:table':[40]}});
  workers[1]!.post({type:'cursor',key:'shard:table',value:43,pendingSelf:[],generation});workers[1]!.emit('exit',1);
  await until(()=>workers.length===3);assert.equal(workers[2]!.commands[0]!.pendingSelf,undefined);
 }finally{await observer.close();}
});
