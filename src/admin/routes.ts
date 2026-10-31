import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { SettingsRepository } from '../config/settings.js';
import { MemoryRepository } from '../memory/repository.js';
import { ExpressionCatalog } from '../expressions/catalog.js';
import type { Telemetry } from '../monitoring/telemetry.js';
import type { Store } from '../storage/store.js';
export function adminRoutes(app:FastifyInstance,store:Store,settings:SettingsRepository,telemetry:Telemetry,changed:()=>void){
  const memories=new MemoryRepository(store),expressions=new ExpressionCatalog(store,'assets/expressions');
  for(const [url,file,type] of [['/','index.html','text/html'],['/admin.js','admin.js','text/javascript'],['/admin.css','admin.css','text/css']])app.get(url!,async(_,reply)=>reply.type(type!).send(await readFile(new URL(file!,import.meta.url),'utf8')));
  app.get('/api/settings',async()=>settings.get());
  app.put('/api/settings',async req=>{const s=settings.save(req.body);changed();return s;});
  app.get('/api/status',async()=>telemetry.snapshot());
  app.get('/api/memory',async req=>memories.context(z.object({scope:z.string().min(1).max(600)}).parse(req.query).scope));
  app.put('/api/memory',async req=>{memories.put(req.body);return {ok:true};});
  app.delete('/api/memory',async req=>{const body=z.object({scope:z.string().max(600),subject:z.string().optional(),key:z.string().optional()}).parse(req.body);changed();if(body.subject&&body.key)memories.remove(body.scope,body.subject,body.key);else memories.forget(body.scope);return {ok:true};});
  app.get('/api/expressions',async()=>expressions.list());
  app.put('/api/expressions',async req=>expressions.put(req.body));
  app.delete('/api/expressions/:id',async req=>{expressions.remove(z.object({id:z.string()}).parse(req.params).id);return {ok:true};});
  app.post('/api/session',async req=>{const body=z.object({scope:z.string().max(600),paused:z.boolean()}).parse(req.body);store.db.prepare('INSERT INTO session_pause VALUES(?,?) ON CONFLICT(scope) DO UPDATE SET paused=excluded.paused').run(body.scope,Number(body.paused));changed();return {ok:true};});
}
