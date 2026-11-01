import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {NativeMemoBridge} from '../src/adapters/wechat/native/bridge.js';

function fixture(mode='ready'){
  const children:ChildProcessWithoutNullStreams[]=[];
  const bridge=new NativeMemoBridge('unused',()=>{
    const child=spawn(process.execPath,['tests/fixtures/native-host.mjs',mode],{windowsHide:true,stdio:'pipe'});
    children.push(child);return child;
  });return {bridge,children};
}
test('native IPC bridge validates responses and reaps its helper on stop',async()=>{
  const {bridge,children}=fixture();await bridge.start();
  assert.equal((await bridge.status()).ready,true);assert.equal((await bridge.send('synthetic','test')).nativeReturned,true);
  await Promise.all([bridge.stop(),bridge.stop()]);assert.notEqual(children[0]!.exitCode,null);
  await assert.rejects(bridge.status(),/disconnected/);
  await bridge.start();assert.equal(children.length,2);await bridge.stop();
});
for(const mode of ['fatal','invalid'])test(`native IPC ${mode} startup cannot leave a live helper`,async()=>{
  const {bridge,children}=fixture(mode);await assert.rejects(bridge.start());
  assert.ok(children[0]!.exitCode!==null||children[0]!.signalCode!==null);await bridge.stop();
});
test('agent failure rejects ambiguous send and cleanup precedes replacement helper',async()=>{
  const {bridge,children}=fixture('detach');await bridge.start();
  await assert.rejects(bridge.send('synthetic','test'),/failure|exited/);
  await bridge.stop();assert.ok(children[0]!.exitCode!==null||children[0]!.signalCode!==null);
  await bridge.start();assert.equal(children.length,2);assert.equal((await bridge.status()).ready,true);await bridge.stop();
});
