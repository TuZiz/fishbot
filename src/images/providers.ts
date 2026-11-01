import type {Environment} from '../config/environment.js';
import type {ImageProvider} from './client.js';

/** A deliberately selected backup handles new jobs; an ambiguous old job is never replayed. */
export function imageProviders(env:Environment):ImageProvider[]{
  const backup=env.IMAGE_BACKUP_KEY?{url:env.IMAGE_BACKUP_URL,key:env.IMAGE_BACKUP_KEY,model:env.IMAGE_BACKUP_MODEL}:undefined;
  if(env.IMAGE_PROVIDER==='backup')return backup?[backup]:[];
  return env.IMAGE_API_KEY?[{url:env.IMAGE_BASE_URL,key:env.IMAGE_API_KEY,model:env.IMAGE_MODEL},...(backup?[backup]:[])]:[];
}
