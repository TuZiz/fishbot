import test from 'node:test';
import assert from 'node:assert/strict';
import {RecoveringNativeBridge} from '../src/adapters/wechat/native/recovering-bridge.js';
import type {NativeBridgePort,NativeOutcome} from '../src/adapters/wechat/native/bridge.js';
class Transport implements NativeBridgePort {
  starts=0;stops=0;sends=0;failStart=0;disconnected=false;ready=true;
  async start(){this.starts++;if(this.failStart-->0)throw Error('client absent');this.disconnected=false;}
  async stop(){this.stops++;}
  async status(){if(this.disconnected)throw Error('client detached');return {ready:this.ready,busy:false,expiresAt:0};}
  async send():Promise<NativeOutcome>{this.sends++;throw Error('outcome unknown');}
}
async function until(check:()=>boolean){const end=Date.now()+1000;while(!check()){if(Date.now()>end)assert.fail('recovery condition timed out');await new Promise(r=>setTimeout(r,5));}}
test('missing client enters backoff, recovers and stops without continuing retries',async()=>{
 const transport=new Transport();transport.failStart=2;const bridge=new RecoveringNativeBridge(transport,5,20);
 await bridge.start();assert.equal((await bridge.status()).state,'backoff');await until(()=>transport.starts>=3);await until(()=>transport.starts>=3&&!transport.disconnected);assert.equal((await bridge.status()).ready,true);
 await bridge.stop();const count=transport.starts;await new Promise(r=>setTimeout(r,30));assert.equal(transport.starts,count);assert.equal((await bridge.status()).state,'stopped');
});
test('transport detach reconnects, but an ambiguous send is never automatically retried',async()=>{
 const transport=new Transport(),bridge=new RecoveringNativeBridge(transport,5,20);await bridge.start();
 try{await assert.rejects(bridge.send('memo','test'),/unknown/);await until(()=>transport.starts>=2);assert.equal(transport.sends,1);transport.disconnected=true;await until(()=>transport.starts>=3);assert.equal((await bridge.status()).ready,true);}finally{await bridge.stop();}
});
test('invalidated context is rejected before invoking native send',async()=>{
 const transport=new Transport(),bridge=new RecoveringNativeBridge(transport,5,20);await bridge.start();transport.ready=false;
 try{assert.equal((await bridge.send('memo','test')).attempted,false);assert.equal(transport.sends,0);}finally{await bridge.stop();}
});

test('stop during startup cannot publish a stale ready state or dispatch queued work',async()=>{
 const transport=new Transport();let release!:()=>void;
 transport.start=async()=>{transport.starts++;await new Promise<void>(r=>{release=r;});};
 const bridge=new RecoveringNativeBridge(transport,5,20),starting=bridge.start();
 await until(()=>transport.starts===1);
 const sending=bridge.send('memo','must not dispatch'),stopping=bridge.stop();release();
 await Promise.all([starting,stopping]);assert.equal((await sending).attempted,false);assert.equal(transport.sends,0);
 assert.equal((await bridge.status()).state,'stopped');
 await new Promise(r=>setTimeout(r,20));assert.equal(transport.starts,1);
});

test('restart waits for an in-flight send and old cleanup before taking transport ownership',async()=>{
 const transport=new Transport();let release!:(result:NativeOutcome)=>void;
 transport.send=async()=>{transport.sends++;return new Promise<NativeOutcome>(r=>{release=r;});};
 const bridge=new RecoveringNativeBridge(transport,5,20);await bridge.start();
 const sending=bridge.send('memo','single dispatch');await until(()=>transport.sends===1);
 const stopping=bridge.stop(),starting=bridge.start();
 await new Promise(r=>setTimeout(r,15));assert.equal(transport.starts,1);assert.equal(transport.stops,0);
 release({attempted:true,nativeReturned:true});await Promise.all([sending,stopping,starting]);
 try{assert.equal(transport.starts,2);assert.equal(transport.stops,1);assert.equal((await bridge.status()).ready,true);assert.equal(transport.sends,1);}finally{await bridge.stop();}
});

test('concurrent callers cannot both dispatch a native send',async()=>{
 const transport=new Transport();transport.send=async()=>{transport.sends++;return {attempted:true,nativeReturned:true};};
 const bridge=new RecoveringNativeBridge(transport,5,20);await bridge.start();
 try{const results=await Promise.all([bridge.send('memo','one'),bridge.send('memo','two')]);assert.equal(results.filter(r=>r.attempted).length,1);assert.equal(transport.sends,1);}finally{await bridge.stop();}
});
