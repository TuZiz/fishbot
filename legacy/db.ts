import Database from 'better-sqlite3';
import type { Incoming } from './schema.js';
const db = new Database(process.env.DB_PATH || './fishbot.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(`
CREATE TABLE IF NOT EXISTS incoming (
  id TEXT PRIMARY KEY, conversation TEXT NOT NULL, kind TEXT NOT NULL,
  sender TEXT NOT NULL, sender_name TEXT, text TEXT NOT NULL,
  timestamp INTEGER NOT NULL, source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_incoming_conv ON incoming(conversation,timestamp);
CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT, incoming_id TEXT NOT NULL UNIQUE,
  conversation TEXT NOT NULL, text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  PRIMARY KEY(scope,key)
);`);
export function saveIncoming(m: Incoming): boolean {
 const r = db.prepare(`INSERT OR IGNORE INTO incoming(id,conversation,kind,sender,sender_name,text,timestamp,source)
 VALUES(?,?,?,?,?,?,?,?)`).run(m.id,m.conversationId,m.kind,m.senderId,m.senderName??null,m.text,m.timestamp,m.source);
 return r.changes > 0;
}
export function history(conversation: string) {
 return db.prepare('SELECT sender, sender_name AS senderName, text FROM incoming WHERE conversation=? ORDER BY timestamp DESC LIMIT 15').all(conversation).reverse() as {sender:string;senderName:string|null;text:string}[];
}
export function queueReply(m:Incoming, text:string) {
 db.prepare('INSERT OR IGNORE INTO replies(incoming_id,conversation,text,status,created_at) VALUES(?,?,?,?,?)').run(m.id,m.conversationId,text,'pending',Date.now());
}
export function getPending() {return db.prepare("SELECT id, incoming_id AS incomingId, conversation, text, created_at AS createdAt FROM replies WHERE status='pending' ORDER BY id DESC LIMIT 30").all();}
export function putMemory(scope:string,key:string,value:string){db.prepare('INSERT INTO memories(scope,key,value) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value').run(scope,key,value);}
export function getMemories(scope:string){return db.prepare('SELECT key,value FROM memories WHERE scope=? LIMIT 30').all(scope) as {key:string;value:string}[];}
export function deleteMemory(scope:string,key:string){return db.prepare('DELETE FROM memories WHERE scope=? AND key=?').run(scope,key).changes>0;}
export function lastReplyTime(conversation:string){const r=db.prepare('SELECT MAX(created_at) AS t FROM replies WHERE conversation=?').get(conversation) as {t:number|null};return r.t??0;}
