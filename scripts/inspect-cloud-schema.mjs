import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {snapshotDatabase} from '../dist/adapters/wechat/database/snapshot.js';
const root=process.env.WECHAT_STORAGE_PATH,key=await readFile(process.env.WECHAT_DB_KEY_FILE,'utf8').then(v=>v.trim());
if(!root)throw new Error('WECHAT_STORAGE_PATH is required');
const folder=await mkdtemp(join(tmpdir(),'fishbot-cloud-schema-'));const result={readOnly:true,databases:{}};
try{
 for(const [name,file] of [['contact','contact/contact.db'],['session','session/session.db']]){
  const path=join(folder,`${name}.sqlite`);await snapshotDatabase(join(root,file),path,key);const db=new DatabaseSync(path,{readOnly:true});
  try{
   const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>String(row.name));
   result.databases[name]=tables.map(table=>({table,columns:db.prepare(`PRAGMA table_info("${table.replaceAll('"','""')}")`).all().map(row=>String(row.name)),rowCount:Number(db.prepare(`SELECT COUNT(*) AS n FROM "${table.replaceAll('"','""')}"`).get().n)}));
  }finally{db.close();}
 }
}finally{await rm(folder,{recursive:true,force:true});}
console.log(JSON.stringify(result));
