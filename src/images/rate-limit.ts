import {createHash} from 'node:crypto';
import type {Store} from '../storage/store.js';
import type {Incoming} from '../schema.js';
import type {Settings} from '../config/settings.js';

type Intent={prompt:string;edit:boolean};
export interface ImageLimit {reason:'busy'|'cooldown'|'duplicate';waitMs:number}
/** Reservations cover lookup/generation; paid starts and notices survive application restarts. */
export class ImageRateLimit {
  private active=new Map<string,{id:string;sender:string}>();
  constructor(private store:Store){store.db.exec(`
    CREATE TABLE IF NOT EXISTS image_rate_requests(scope TEXT NOT NULL,incoming TEXT NOT NULL,sender TEXT NOT NULL,fingerprint TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(scope,incoming));
    CREATE INDEX IF NOT EXISTS image_rate_created ON image_rate_requests(created);
    CREATE TABLE IF NOT EXISTS image_rate_notices(scope TEXT NOT NULL,sender TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(scope,sender));
  `);}
  private fingerprint(message:Incoming,intent:Intent){return createHash('sha256').update(JSON.stringify([intent.edit,intent.prompt.normalize('NFKC').replace(/@\S+/g,'').replace(/\s+/g,'').toLowerCase(),intent.edit?(message.quote?.image?.md5??message.quote?.messageId):null])).digest('hex');}
  check(scope:string,message:Incoming,intent:Intent,settings:Settings,now=Date.now()):ImageLimit|undefined {
    if([...this.active.entries()].some(([key,value])=>(key===scope||value.sender===message.senderId)&&!(key===scope&&value.id===message.id)))return {reason:'busy',waitMs:0};
    const duplicate=this.store.db.prepare('SELECT MAX(created) AS last FROM image_rate_requests WHERE scope=? AND fingerprint=? AND created>?').get(scope,this.fingerprint(message,intent),now-settings.imageDuplicateWindowMs)?.last;
    if(duplicate!==null&&duplicate!==undefined)return {reason:'duplicate',waitMs:Math.max(0,Number(duplicate)+settings.imageDuplicateWindowMs-now)};
    const last=this.store.db.prepare('SELECT MAX(created) AS last FROM image_rate_requests WHERE (scope=? OR sender=?) AND created>?').get(scope,message.senderId,now-settings.imageCooldownMs)?.last;
    if(last!==null&&last!==undefined)return {reason:'cooldown',waitMs:Math.max(0,Number(last)+settings.imageCooldownMs-now)};
  }
  reserve(scope:string,message:Incoming){this.active.set(scope,{id:message.id,sender:message.senderId});}
  release(scope:string,id:string){if(this.active.get(scope)?.id===id)this.active.delete(scope);}
  start(scope:string,message:Incoming,intent:Intent,settings:Settings,now=Date.now()):ImageLimit|undefined {
    const blocked=this.check(scope,message,intent,settings,now);if(blocked)return blocked;
    this.store.db.prepare('INSERT OR IGNORE INTO image_rate_requests VALUES(?,?,?,?,?)').run(scope,message.id,message.senderId,this.fingerprint(message,intent),now);
    this.store.db.prepare('DELETE FROM image_rate_requests WHERE created<?').run(now-86400000);
    return undefined;
  }
  notify(scope:string,sender:string,now=Date.now()){
    const previous=this.store.db.prepare('SELECT created FROM image_rate_notices WHERE scope=? AND sender=?').get(scope,sender);
    if(previous&&now-Number(previous.created)<15000)return false;
    this.store.db.prepare('INSERT INTO image_rate_notices VALUES(?,?,?) ON CONFLICT(scope,sender) DO UPDATE SET created=excluded.created').run(scope,sender,now);
    this.store.db.prepare('DELETE FROM image_rate_notices WHERE created<?').run(now-86400000);
    return true;
  }
  message(limit:ImageLimit){return limit.reason==='busy'?'正在处理图片，请等结果，重复发送不会加速。':limit.reason==='duplicate'?'刚处理过相同的图片请求，短时间内不会重复生成。':`图片请求太频繁，请约${Math.max(1,Math.ceil(limit.waitMs/1000))}秒后再试。`;}
  clear(){this.active.clear();}
}
