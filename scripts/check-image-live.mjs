// Sanitized live state. Never prints settings text, keys or chat bodies.
import 'dotenv/config';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:8765',headers={'x-fishbot-token':process.env.INGEST_TOKEN};
const request=async(path)=>{const r=await fetch(base+path,{headers,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Live state request rejected');return r.json();};
const [health,settings,jobs]=await Promise.all([request('/health'),request('/api/settings'),request('/replies')]);
const images=jobs.filter(j=>j.kind==='image').map(j=>({id:j.id,scopeHash:createHash('sha256').update(j.scope).digest('hex').slice(0,12),incoming:j.incoming,status:j.status,attempts:j.attempts,created:j.created,result:j.result?JSON.parse(j.result):null}));
const report={at:new Date().toISOString(),ok:health.ok,backend:health.adapter.backend,requiresChatWindow:health.adapter.requiresChatWindow,imagesSupported:health.adapter.imagesSupported??health.adapter.context?.imagesSupported===true,imageConfigured:health.imageConfigured,imageProvider:health.imageProvider,paused:health.paused,dryRun:health.dryRun,allConversations:settings.allConversations,whitelistCount:settings.whitelist.length,images};
await mkdir('data/research/images',{recursive:true});await writeFile('data/research/images/live-image-status.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
