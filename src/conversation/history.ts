import type { Store } from '../storage/store.js';
import type { Incoming } from '../schema.js';
export class History {
  constructor(private store:Store) {}
  recent(scope:string,limit=30) {
    const incoming=this.store.db.prepare('SELECT rowid,body FROM messages WHERE scope=? ORDER BY rowid DESC LIMIT ?').all(scope,limit).reverse().map(r=>JSON.parse(String(r.body)) as Incoming);
    const replies=this.store.db.prepare("SELECT text,incoming,status FROM outbox WHERE scope=? AND status IN ('sent','dry-run') ORDER BY id DESC LIMIT 8").all(scope).reverse();
    return {messages:incoming,replies:replies.map(r=>({text:String(r.text),incoming:String(r.incoming)}))};
  }
}
