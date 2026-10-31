import {fork} from 'node:child_process';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
const child=fork('dist/index.js',[],{silent:true,env:{...process.env,PORT:String(port),INGEST_TOKEN:'local-production-smoke-123456789',DB_PATH:':memory:',DEEPSEEK_API_KEY:'',DRY_RUN:'true'}});
let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
const exited=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));
try{
 let health;
 for(let n=0;n<60;n++){try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){health=await r.json();break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal(health?.adapter.backend,'mock');assert.equal(health.dryRun,true);
 const page=await fetch(`http://127.0.0.1:${port}/`);assert.equal(page.status,200);assert.match(await page.text(),/FishBot/);
 assert.equal((await fetch(`http://127.0.0.1:${port}/api/settings`)).status,401);
 child.send({type:'shutdown'});
 const result=await Promise.race([exited,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('shutdown timeout')),5000);timer.unref();})]);
 assert.equal(result.code,0);console.log('Production HTTP, admin static, auth and graceful IPC shutdown passed');
}catch(e){console.error(output);throw e;}finally{if(child.exitCode===null)child.kill();}
