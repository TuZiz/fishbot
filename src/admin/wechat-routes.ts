import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import {access} from 'node:fs/promises';
import {DatabaseObserver} from '../adapters/wechat/database/observer.js';
export function wechatRoutes(app:FastifyInstance,sharedObserver?:DatabaseObserver){
  const observer=sharedObserver??new DatabaseObserver();
  app.post('/api/wechat/start',async()=>{await access('data/wechat/key.xml');await access('data/wechat/storage-path.txt');observer.start();return observer.status;});
  app.get('/api/wechat/status',async()=>observer.status);
  app.get('/api/wechat/sessions',async()=>observer.sessions);
  app.post('/api/wechat/watch',async req=>{const ids=z.object({ids:z.array(z.string().min(1).max(256)).min(1).max(5)}).parse(req.body).ids;if(ids.some(id=>!observer.sessions.some(s=>s.id===id)))throw new Error('Select an existing conversation');observer.watch(ids);return {watching:ids.length,readOnly:true,aiForwarding:false};});
  app.get('/api/wechat/events',async()=>observer.events);
  app.post('/api/wechat/stop',async()=>{await observer.close();return observer.status;});
  if(!sharedObserver)app.addHook('onClose',async()=>observer.close());
}
