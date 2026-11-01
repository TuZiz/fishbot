import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

// Deterministic Frida memory model. These are guard tests, never a WeChat compatibility result.
function fixture(options:{duplicates?:boolean;unbound?:boolean;wrongSelf?:boolean;wrongPid?:boolean}={}){
  const memory=new Map<bigint,bigint>(),numbers=new Map<bigint,number>(),recipients=new Map<bigint,number>();
  class Pointer {
    constructor(readonly value:bigint){}
    add(offset:number){return new Pointer(this.value+BigInt(offset));}
    readPointer(){return new Pointer(memory.get(this.value)??0n);}
    readU32(){return numbers.get(this.value)??0;}
    equals(other:Pointer){return this.value===other.value;}
    isNull(){return this.value===0n;}
    toString(){return '0x'+this.value.toString(16);}
    toMatchPattern(){return 'verified-vtable-pattern';}
  }
  const ptr=(value:string|number|bigint)=>new Pointer(BigInt(value)),base=ptr(0x180000000n),vtable=base.add(0x9881d28);
  const hooks=new Map<string,{onEnter?:(args:Pointer[])=>void;onLeave?:()=>void}>();
  function object(at:bigint,target:number){
    const p=ptr(at),data=p.add(0x1000),privateData=p.add(0x2000);
    memory.set(p.value,vtable.value);memory.set(p.add(8).value,privateData.value);
    memory.set(privateData.add(8).value,options.wrongSelf?0n:p.value);
    memory.set(p.add(16).value,data.value);memory.set(data.add(0x2a0).value,0x5000n);
    recipients.set(data.add(0x260).value,target);return p;
  }
  const first=object(0x100000n,options.unbound?0:1),matches=[first];
  if(options.duplicates)matches.push(object(0x300000n,1));
  const context={
    ptr,Process:{id:17,getModuleByName:()=>({getExportByName:()=>ptr(1)}),getCurrentThreadId:()=>23,
      enumerateRanges:()=>[{base:ptr(0x100000),size:1024*1024}]},
    Memory:{alloc:()=>ptr(0x900000),scan:(_at:Pointer,_size:number,_pattern:string,callbacks:{onMatch:(p:Pointer)=>void;onComplete:()=>void})=>{for(const p of matches)callbacks.onMatch(p);callbacks.onComplete();}},
    NativeFunction:function(){return (_window:Pointer,pid:Pointer)=>{numbers.set(pid.value,options.wrongPid?99:17);return 23;};},
    Interceptor:{attach:(at:Pointer,handler:typeof hooks extends Map<string,infer H>?H:never)=>{hooks.set(at.toString(),handler);return {detach(){}};}},
    matches:(at:Pointer,bytes:number[])=>recipients.get(at.value)===bytes[0],
  };
  interface Registry {forTarget(id:string):Pointer|null;status():{ready:boolean;readyTargetCount:number;destroyed:number};dispose():void}
  const create=new Script(readFileSync('native/context-registry.js','utf8')+';createContextRegistry;').runInNewContext(context) as (c:unknown,m:unknown,listeners:unknown[])=>Registry;
  const registry=create({windowHandle:'0x11',targets:[{id:'private',bytes:[1]},{id:'group',bytes:[2]}]},{base},[]);
  return {registry,first,memory,recipients,object,hooks,base,ptr,matches};
}

test('unbound verified QObject can become an authorized context without another warmup submit',()=>{
  const f=fixture({unbound:true});assert.equal(f.registry.forTarget('private'),null);
  f.recipients.set(f.first.add(0x1000+0x260).value,1);
  assert.equal(f.registry.forTarget('private')?.toString(),f.first.toString());
  f.registry.dispose();assert.equal(f.registry.forTarget('private'),null);
});
test('live rebinding checks the recipient again; deleting destructor invalidates even readable memory',()=>{
  const f=fixture();assert.equal(f.registry.status().readyTargetCount,1);
  f.recipients.set(f.first.add(0x1000+0x260).value,2);
  assert.equal(f.registry.forTarget('private'),null);assert.ok(f.registry.forTarget('group'));
  f.hooks.get(f.base.add(0x3e8edb0).toString())!.onEnter!([f.first]);
  assert.equal(f.registry.forTarget('group'),null);assert.equal(f.registry.status().destroyed,1);f.registry.dispose();
});
test('ambiguous contexts and a forged QObject self pointer fail closed',()=>{
  const f=fixture({duplicates:true});assert.equal(f.registry.forTarget('private'),null);
  f.hooks.get(f.base.add(0x3e8edb0).toString())!.onEnter!([f.matches[1]!]);
  assert.ok(f.registry.forTarget('private'));f.registry.dispose();
  const forged=fixture({wrongSelf:true});assert.equal(forged.registry.status().ready,false);forged.registry.dispose();
});
test('a stale service pointer or foreign window PID cannot authorize native dispatch',()=>{
  const f=fixture();f.memory.set(f.first.add(0x1000+0x2a0).value,0n);assert.equal(f.registry.forTarget('private'),null);f.registry.dispose();
  assert.throws(()=>fixture({wrongPid:true}),/Verified client window unavailable/);
});
