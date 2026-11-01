import { ImageClient } from '../images/client.js';
import {GeneratedImageReferences} from '../images/references.js';
import type {ImageReferences} from '../images/references.js';
import {imageProviders} from '../images/providers.js';
import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ZodError,z } from 'zod';
import { MockAdapter } from '../adapters/mock/adapter.js';
import type { WechatAdapter } from '../adapters/wechat/contract.js';
import { incomingSchema } from '../schema.js';
import { Store,scopeOf } from '../storage/store.js';
import { Delivery } from './delivery.js';
import { SettingsRepository } from '../config/settings.js';
import type { Environment } from '../config/environment.js';
import { DeepSeekClient,type ModelClient } from '../ai/client.js';
import { ConversationEngine } from '../conversation/engine.js';
import { Telemetry } from '../monitoring/telemetry.js';
import {TerminalActivity} from '../monitoring/activity.js';
import { MemoryRepository } from '../memory/repository.js';
import { adminRoutes } from '../admin/routes.js';
import { wechatRoutes } from '../admin/wechat-routes.js';
import { DatabaseObserver } from '../adapters/wechat/database/observer.js';
import { ReadOnlyDatabaseAdapter } from '../adapters/wechat/database/read-only-adapter.js';
export async function createApplication<A extends WechatAdapter=MockAdapter>(env:Environment,modelOverride?:ModelClient,adapterOverride?:A,imageReferenceFallback?:ImageReferences){
  if(env.DB_PATH!==':memory:')await mkdir(dirname(env.DB_PATH),{recursive:true});
  const store=new Store(env.DB_PATH),settings=new SettingsRepository(store,{whitelist:env.TEST_SCOPES}),telemetry=new Telemetry(store);
  const activity=new TerminalActivity(undefined,Object.entries(env).filter(([key,value])=>/(KEY|TOKEN|SECRET|PASSWORD)$/.test(key)&&typeof value==='string').map(([,value])=>String(value)),env.TERMINAL_MESSAGE_CONTENT!=='false');
  const databaseObserver=env.ADAPTER==='wechat-database'?new DatabaseObserver(undefined,2000,{storagePath:env.WECHAT_STORAGE_PATH,keyPath:env.WECHAT_DB_KEY_FILE}):undefined;
  const adapter=(adapterOverride??(env.ADAPTER==='wechat-database'?new ReadOnlyDatabaseAdapter(databaseObserver!,settings.get().whitelist.map(v=>String(v[1]))):new MockAdapter())) as A,allowed=new Set(settings.get().whitelist.map(v=>JSON.stringify(v)));
  const delivery=new Delivery(store,adapter,env.DRY_RUN==='true',allowed,scope=>{const s=settings.get(),[kind,id]=JSON.parse(scope);return !s.paused&&(kind==='private'?s.privateEnabled:s.groupEnabled&&s.groups[id]?.enabled!==false)&&!store.db.prepare('SELECT paused FROM session_pause WHERE scope=?').get(scope)?.paused;});
  const model=modelOverride??new DeepSeekClient(env.DEEPSEEK_API_KEY,v=>telemetry.usage(v),{url:'https://api.deepseek.com/chat/completions',timeoutMs:env.AI_TIMEOUT_MS,retries:env.AI_RETRIES,minIntervalMs:env.AI_INTERVAL_MS});
  delivery.activity=activity.emit;
  const engine=new ConversationEngine(store,settings,model,delivery,(err,scope)=>{telemetry.error(err,scope);activity.emit({stage:'error',scope,text:err instanceof Error?err.name:'Error'});});
  engine.activity=activity.emit;
  engine.canSendImages=adapter.supportsGeneratedImages===true&&env.DRY_RUN!=='true';
  engine.imageReferences=new GeneratedImageReferences(store,'data/generated',imageReferenceFallback);
  engine.imageTransportReady=async()=>{const status=await adapter.getStatus();return status.connected&&adapter.supportsGeneratedImages===true;};
  const providers=imageProviders(env);
  if(providers.length)engine.imageGenerator=new ImageClient(providers,undefined,undefined,{timeoutMs:env.IMAGE_TIMEOUT_MS,downloadOrigins:env.IMAGE_DOWNLOAD_ORIGINS});
  const app=Fastify({logger:{redact:['req.headers.x-fishbot-token']},bodyLimit:65536});
  const sync=()=>{engine.invalidate();engine.canSendImages=adapter.supportsGeneratedImages===true&&env.DRY_RUN!=='true';const s=settings.get();allowed.clear();const scopes=s.allConversations&&databaseObserver?databaseObserver.sessions.map(v=>[v.kind as 'private'|'group',v.id] as const):s.whitelist;for(const v of scopes)allowed.add(JSON.stringify(v));delivery.paused=s.paused;if(databaseObserver&&adapter instanceof ReadOnlyDatabaseAdapter){const ids=s.allConversations?databaseObserver.sessions.map(v=>v.id):s.whitelist.map(v=>String(v[1]));void adapter.setScopes(ids).catch(error=>telemetry.error(error,'wechat-scope-sync'));}};sync();
  adapter.onMessage(m=>{if(settings.get().allConversations&&!m.isSelf)allowed.add(scopeOf(m));engine.receive(m);});
  const publicPaths=new Set(['/','/admin.js','/admin.css','/health']);
  app.addHook('onRequest',async(req,rep)=>{
    rep.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if(publicPaths.has(req.url))return;
    const supplied=req.headers['x-fishbot-token'];const a=Buffer.from(typeof supplied==='string'?supplied:''),b=Buffer.from(env.INGEST_TOKEN);
    if(a.length!==b.length||!timingSafeEqual(a,b))return rep.code(401).send({error:'unauthorized'});
  });
  app.setErrorHandler((error,req,rep)=>{if(error instanceof ZodError)return rep.code(400).send({error:'validation failed',issues:error.issues.map(i=>({path:i.path,message:i.message}))});if(error && typeof error==='object' && 'statusCode' in error && typeof error.statusCode==='number' && error.statusCode<500)return rep.code(error.statusCode).send({error:'invalid request'});telemetry.error(error,req.routeOptions.url??'http');return rep.code(500).send({error:'internal error; see diagnostics'});});
  app.get('/health',async()=>({ok:true,adapter:await adapter.getStatus(),dryRun:env.DRY_RUN==='true',paused:settings.get().paused,aiConfigured:!!env.DEEPSEEK_API_KEY,imageConfigured:!!engine.imageGenerator,imageProvider:env.IMAGE_PROVIDER,realWechatVerified:false,uptime:process.uptime()}));
  app.post('/ingest',async(req,rep)=>{
    const m=incomingSchema.parse(req.body);if(Math.abs(Date.now()-m.timestamp)>300000)return rep.code(400).send({error:'stale timestamp'});
    if(!allowed.has(scopeOf(m)))return rep.code(403).send({error:'scope not allowed'});
    const accepted=engine.receive(m);
    return {accepted,backend:(await adapter.getStatus()).backend,autoReply:true};
  });
  app.get('/replies',async()=>store.db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 100').all());
  app.post('/probe/send',async(req,rep)=>{const {message,text}=z.object({message:incomingSchema,text:z.string().min(1).max(5000)}).parse(req.body);if(!allowed.has(scopeOf(message)))return rep.code(403).send({error:'scope not allowed'});store.enqueue(message,text);await delivery.flush();return {queued:true,backend:(await adapter.getStatus()).backend,dryRun:env.DRY_RUN==='true'};});
  app.get('/api/mock/sent',async()=>adapter instanceof MockAdapter?adapter.sent:[]);
  app.post('/control',async req=>{const {paused}=z.object({paused:z.boolean()}).parse(req.body);settings.save({...settings.get(),paused});sync();return {paused};});
  adminRoutes(app,store,settings,telemetry,sync);
  wechatRoutes(app,databaseObserver);
  const maintenance=setInterval(()=>{try{const s=settings.get();new MemoryRepository(store).cleanup(s.retentionDays);telemetry.cleanup(s.retentionDays);store.cleanup(s.retentionDays);void delivery.flush().catch(err=>telemetry.error(err,'delivery'));}catch(err){telemetry.error(err,'maintenance');}},10000);maintenance.unref();
  app.addHook('onClose',async()=>{clearInterval(maintenance);delivery.paused=true;await engine.close();await delivery.close();await adapter.disconnect();store.close();});
  try{await adapter.connect();sync();engine.recover();}catch(error){await app.close();throw error;}
  return {app,engine,store,adapter,settings,delivery,activity};
}



