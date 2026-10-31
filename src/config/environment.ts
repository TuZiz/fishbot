import { z } from 'zod';
export const environmentSchema=z.object({PORT:z.coerce.number().int().min(1).max(65535).default(8765),INGEST_TOKEN:z.string().min(24).refine(v=>!v.startsWith('replace-')),DRY_RUN:z.enum(['true','false']).default('true'),DB_PATH:z.string().default('./data/fishbot.sqlite'),TEST_SCOPES:z.string().default('[]').transform(v=>JSON.parse(v) as unknown),DEEPSEEK_API_KEY:z.preprocess(v=>v===''?undefined:v,z.string().min(1).optional()),AI_TIMEOUT_MS:z.coerce.number().int().min(100).max(120000).default(30000),AI_RETRIES:z.coerce.number().int().min(0).max(5).default(2),AI_INTERVAL_MS:z.coerce.number().int().min(0).max(60000).default(500),ADAPTER:z.literal('mock').default('mock')});
export type Environment=z.infer<typeof environmentSchema>;

