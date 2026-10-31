import type { DatabaseSync } from 'node:sqlite';
export function migrate(db:DatabaseSync){
  const version=Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if(version>3)throw new Error(`Database schema ${version} is newer than supported version 3`);
  db.exec('BEGIN');
  try{
    db.exec(`CREATE TABLE IF NOT EXISTS messages(scope TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY,scope TEXT NOT NULL,incoming TEXT NOT NULL,target TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,result TEXT,UNIQUE(scope,incoming));`);
    const columns=new Set(db.prepare('PRAGMA table_info(outbox)').all().map(c=>String(c.name)));
    for(const [name,definition] of [['kind',"TEXT NOT NULL DEFAULT 'text'"],['created','INTEGER NOT NULL DEFAULT 0'],['attempts','INTEGER NOT NULL DEFAULT 0'],['next_at','INTEGER NOT NULL DEFAULT 0']])if(!columns.has(name!))db.exec(`ALTER TABLE outbox ADD COLUMN ${name} ${definition}`);
    db.exec('CREATE TABLE IF NOT EXISTS seen(scope TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(scope,id)); INSERT OR IGNORE INTO seen SELECT scope,id FROM messages; PRAGMA user_version=3; COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
