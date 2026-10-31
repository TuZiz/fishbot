import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { MemoryRepository } from '../src/memory/repository.js';
import { ExpressionCatalog } from '../src/expressions/catalog.js';
test('memories have scope/provenance, upsert and deletion, reject sensitive values',()=>{
 const s=new Store(':memory:');const r=new MemoryRepository(s),scope='["private","u"]';
 r.put({scope,subject:'u',key:'兴趣',value:'钓鱼',sourceId:'m1'});r.put({scope,subject:'u',key:'兴趣',value:'游泳',sourceId:'m2'});
 assert.equal(r.list(scope).length,1);assert.equal(r.list('["group","u"]').length,0);assert.equal(r.list(scope)[0]!.source,'m2');
 assert.throws(()=>r.put({scope,subject:'u',key:'兴趣',value:'密码12345678',sourceId:'m3'}));r.remove(scope,'u','兴趣');assert.equal(r.list(scope).length,0);s.close();
});
test('expression path containment, missing fallback and cooldown',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fish-images-'));const s=new Store(':memory:');try{
 const c=new ExpressionCatalog(s,root);assert.throws(()=>c.put({id:'bad',file:'../secret.png',tags:['无语']}));
 c.put({id:'happy',file:'happy.png',tags:['开心']});assert.equal(await c.select('happy','g',10000),null);
 await writeFile(join(root,'happy.png'),Buffer.from('placeholder'));assert.ok(await c.select('happy','g',10000));assert.equal(await c.select('happy','g',10000),null);
 }finally{s.close();await rm(root,{recursive:true,force:true});}
});
