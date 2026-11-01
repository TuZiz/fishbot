import { DatabaseSync } from 'node:sqlite';
import type { Incoming } from '../schema.js';
import { sensitive } from '../memory/repository.js';
import { migrate } from './migrations.js';
export interface Job { id: number; scope: string; target: string; text: string; status: string; kind:string }
export const scopeOf = (m: Incoming) => JSON.stringify([m.kind, m.conversationId]);
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    try{migrate(this.db);}catch(error){this.db.close();throw error;}
    // A crash after transport invocation has an ambiguous outcome. Never resend automatically.
    this.db.prepare("UPDATE outbox SET status='unknown' WHERE status='sending'").run();
  }
  accept(m: Incoming,cancelPending=true) {
    this.db.exec('BEGIN');try{
      if(!this.db.prepare('INSERT OR IGNORE INTO seen VALUES(?,?)').run(scopeOf(m),m.id).changes){this.db.exec('COMMIT');return false;}
      this.db.prepare('INSERT INTO messages VALUES(?,?,?)').run(scopeOf(m),m.id,JSON.stringify({...m,text:sensitive(m.text)?'[敏感内容未持久化]':m.text}));
      if(cancelPending)this.db.prepare("UPDATE outbox SET status='cancelled' WHERE scope=? AND status='pending'").run(scopeOf(m));
      this.db.exec('COMMIT');return true;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  cleanup(days:number){const cutoff=Date.now()-days*86400000;this.db.prepare("DELETE FROM messages WHERE CAST(json_extract(body,'$.timestamp') AS INTEGER)<?").run(cutoff);this.db.prepare("UPDATE outbox SET text='' WHERE status NOT IN ('pending','sending') AND created<?").run(cutoff);}
  enqueue(m: Incoming, text: string,kind='text') { this.db.prepare("INSERT OR IGNORE INTO outbox(scope,incoming,target,text,status,kind,created) VALUES(?,?,?,?,'pending',?,?)").run(scopeOf(m),m.id+(kind==='image'?':image':''),m.conversationId,text,kind,Date.now()); }
  pending() { return this.db.prepare("SELECT * FROM outbox WHERE status='pending' AND next_at<=? ORDER BY id LIMIT 100").all(Date.now()) .map(row => ({ id: Number(row.id), scope: String(row.scope), target: String(row.target), text: String(row.text), status: String(row.status),kind:String(row.kind) })); }
  claim(id: number) { return this.db.prepare("UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=? AND status='pending'").run(id).changes === 1; }
  retryKnownFailure(id:number,result:unknown){const attempts=Number(this.db.prepare('SELECT attempts FROM outbox WHERE id=?').get(id)!.attempts);this.db.prepare('UPDATE outbox SET status=?,next_at=?,result=? WHERE id=?').run(attempts<3?'pending':'not-sent',Date.now()+1000*2**attempts,JSON.stringify(result),id);}
  complete(id: number, status: string, result: unknown) { this.db.prepare('UPDATE outbox SET status=?,result=? WHERE id=?').run(status,JSON.stringify(result),id); }
  close() { this.db.close(); }
}


