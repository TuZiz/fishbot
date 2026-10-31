import 'dotenv/config';
import { environmentSchema } from './config/environment.js';
import { createApplication } from './core/application.js';
const env=environmentSchema.parse(process.env);
const {app}=await createApplication(env);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close().catch(()=>{process.exitCode=1;});});
await app.listen({host:'127.0.0.1',port:env.PORT});

process.on('message',message=>{if(message && typeof message==='object' && 'type' in message && message.type==='shutdown')void app.close().then(()=>process.exit(0));});
