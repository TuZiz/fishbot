import 'dotenv/config';
// Windows-friendly supervisor; communicates graceful shutdown over Node IPC.
import {spawn} from 'node:child_process';
import {mkdirSync,appendFileSync,readdirSync,statSync,unlinkSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const logs=join(root,'data','logs');mkdirSync(logs,{recursive:true});
let child,stopping=false,failures=0,restart,healthFailures=0,terminating=false;
const log=(text)=>{const date=new Date().toISOString().slice(0,10);appendFileSync(join(logs,`${date}.log`),text);};
function terminate(){if(!child||terminating)return;terminating=true;child.send({type:'shutdown'});const active=child;const timer=setTimeout(()=>{if(child===active)active.kill();},15000);timer.unref();}
function launch(){
 if(stopping||existsSync(join(root,'data','STOP')))return;
 terminating=false;const started=Date.now();
 child=spawn(process.execPath,['dist/index.js'],{cwd:root,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>log(chunk));
 child.on('error',()=>log('supervisor: child spawn failed\n'));
 child.on('exit',code=>{child=undefined;healthFailures=0;if(stopping)return;failures=Date.now()-started>60000?0:failures+1;const wait=Math.min(60000,1000*2**Math.min(failures,6));log(`supervisor: exit=${code}, restart in ${wait}ms\n`);restart=setTimeout(launch,wait);});
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;clearTimeout(restart);clearInterval(maintenance);terminate();});
const maintenance=setInterval(async()=>{
 if(existsSync(join(root,'data','STOP'))){stopping=true;clearTimeout(restart);terminate();clearInterval(maintenance);return;}
 try{const port=process.env.PORT||8765;const r=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('unhealthy');healthFailures=0;}catch{if(++healthFailures>=3)terminate();}
 for(const name of readdirSync(logs))if(/^\d{4}-\d{2}-\d{2}\.log$/.test(name)&&Date.now()-statSync(join(logs,name)).mtimeMs>30*86400000)unlinkSync(join(logs,name));
},15000);
launch();



