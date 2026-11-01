import {readOwnedImage} from './owned-file.js';
import type {Store} from '../storage/store.js';
import {scopeOf} from '../storage/store.js';
import type {Incoming} from '../schema.js';
import type {ImageRequest} from './client.js';
export interface ImageReferences {resolve(message:Incoming,signal?:AbortSignal):Promise<ImageRequest['reference']>}

/** Resolves a quoted, confirmed bot image in the same conversation to its owned original.
 * Never reads a path supplied by a chat message or downloads a quoted URL.
 */
export class GeneratedImageReferences implements ImageReferences {
  constructor(private store:Store,private directory='data/generated',private fallback?:ImageReferences){}
  async resolve(message:Incoming,signal?:AbortSignal):Promise<ImageRequest['reference']>{
    signal?.throwIfAborted();
    if(!message.quote||message.quote.type!==3)return;
    const row=this.store.db.prepare("SELECT text FROM outbox WHERE scope=? AND target=? AND kind='image' AND status='sent' AND json_extract(result,'$.messageId')=? ORDER BY id DESC LIMIT 1").get(scopeOf(message),message.conversationId,message.quote.messageId);
    if(!row)return this.fallback?.resolve(message,signal);
    const image=await readOwnedImage(String(row.text),this.directory);
    return image?{bytes:image.bytes,mime:image.mime}:undefined;
  }
}
