// Reuses the cloud machine's already running local proxy. Does not alter Windows proxy settings.
import 'dotenv/config';
import {readFile,writeFile,copyFile,rename} from 'node:fs/promises';
const existing=await readFile('.env','utf8');
const patch={HTTPS_PROXY:'http://127.0.0.1:7890',NO_PROXY:[...new Set([...(process.env.NO_PROXY||'').split(',').filter(Boolean),'localhost','127.0.0.1','api.deepseek.com'])].join(','),NODE_USE_ENV_PROXY:'1'};
if(patch.NO_PROXY.split(',').includes('*'))throw Error('Existing proxy bypass wildcard prevents image proxy routing');
await copyFile('.env','data/deploy/env-before-image-proxy-'+Date.now());
const keys=new Set(Object.keys(patch));const lines=existing.split(/\r?\n/).filter(line=>!keys.has(/^\s*([A-Z_]+)\s*=/.exec(line)?.[1]||''));
const output=lines.join('\n').replace(/\n*$/,'\n')+Object.entries(patch).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n';
await writeFile('.env.image-proxy.tmp',output,{flag:'wx',mode:0o600});await rename('.env.image-proxy.tmp','.env');
console.log(JSON.stringify({configured:true,systemProxyChanged:false,deepSeekAndLocalBypass:true,restartRequired:true}));
