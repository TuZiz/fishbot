import { z } from 'zod';
export const imageEnvironmentShape={
  IMAGE_PROVIDER:z.enum(['primary','backup']).default('primary'),
  IMAGE_API_KEY:z.string().optional(),
  IMAGE_TIMEOUT_MS:z.coerce.number().int().min(1000).max(600000).default(180000),
  IMAGE_DOWNLOAD_ORIGINS:z.string().default('').transform(v=>v.split(',').map(s=>s.trim()).filter(Boolean)).pipe(z.array(z.string().url().refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&u.origin===v;}catch{return false;}},'Expected HTTPS origin without path'))),
  IMAGE_BASE_URL:z.string().url().default('https://tp.xtokenmirror.com/v1'),
  IMAGE_MODEL:z.enum(['gpt-image-2.5-flare','gpt-image-2.5-sunburst']).default('gpt-image-2.5-flare'),
  IMAGE_BACKUP_KEY:z.string().optional(),
  IMAGE_BACKUP_URL:z.string().url().default('https://api.zyuou.com/v1'),
  IMAGE_BACKUP_MODEL:z.string().default('gpt-image-2.5-sunburst'),
};
