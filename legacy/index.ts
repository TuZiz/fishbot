import 'dotenv/config';
import Fastify from 'fastify';
import {incomingSchema} from './schema.js';
import {saveIncoming,queueReply,getPending,putMemory,deleteMemory,lastReplyTime} from './db.js';
import {shouldReply} from './decision.js';
import {generate} from './ai.js';
const app=Fastify({logger:true,bodyLimit:64*1024});
app.get('/health',async()=>({ok:true,mode:'dry-run',wechatConnected:false}));
app.addHook('onRequest',async(req,rep)=>{
 if(req.url==='/health')return;
 const expected=process.env.INGEST_TOKEN;
 if(!expected||expected==='replace-with-a-long-random-secret'||req.headers['x-fishbot-token']!==expected){rep.code(401).send({error:'unauthorized'});}
});
const queues=new Map<string,Promise<void>>();
app.post('/ingest',async(req,rep)=>{
 const parsed=incomingSchema.safeParse(req.body);
 if(!parsed.success)return rep.code(400).send({error:parsed.error.flatten()});
 const m=parsed.data;
 if(m.timestamp>Date.now()+60_000||m.timestamp<Date.now()-300_000)return rep.code(400).send({error:'timestamp outside allowed window'});
 if(!saveIncoming(m))return {accepted:false,reason:'duplicate'};
 const previous=queues.get(m.conversationId)||Promise.resolve();
 const task=previous.catch(()=>{}).then(async()=>{
  const d=shouldReply(m,lastReplyTime(m.conversationId));
  if(!d.reply){app.log.info({message:m.id,reason:d.reason},'skipped');return;}
  try{const reply=await generate(m);queueReply(m,reply);app.log.info({conversation:m.conversationId,reply},'dry-run queued');}
  catch(e){app.log.error({err:e,message:m.id},'generation failed');}
 });
 queues.set(m.conversationId,task);
 void task.finally(()=>{if(queues.get(m.conversationId)===task)queues.delete(m.conversationId);});
 return {accepted:true,queued:true,delivery:'disabled'};
});
app.get('/replies',async()=>({items:getPending()}));
app.post('/memory',async(req,rep)=>{
 const value=req.body as Record<string,unknown>|null;
 if(!value||typeof value.scope!=='string'||typeof value.key!=='string'||typeof value.value!=='string'||value.scope.length>256||value.key.length>100||value.value.length>1000)return rep.code(400).send({error:'invalid memory'});
 putMemory(value.scope,value.key,value.value);return {ok:true};
});
app.delete('/memory',async(req,rep)=>{
 const value=req.body as Record<string,unknown>|null;
 if(!value||typeof value.scope!=='string'||typeof value.key!=='string')return rep.code(400).send({error:'invalid request'});
 return {deleted:deleteMemory(value.scope,value.key)};
});
const port=Number(process.env.PORT||8765);
await app.listen({host:process.env.HOST||'127.0.0.1',port});
