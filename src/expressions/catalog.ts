import { realpath,stat } from 'node:fs/promises';
import { resolve,relative,isAbsolute } from 'node:path';
import { z } from 'zod';
import type { Store } from '../storage/store.js';
export const expressionSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),file:z.string().min(1).max(256),tags:z.array(z.string().min(1).max(20)).min(1).max(12),enabled:z.boolean().default(true)});
export class ExpressionCatalog {
  private last=new Map<string,number>();
  constructor(private store:Store,private root:string){store.db.exec('CREATE TABLE IF NOT EXISTS expressions(id TEXT PRIMARY KEY,body TEXT NOT NULL)');}
  list(){return this.store.db.prepare('SELECT body FROM expressions ORDER BY id').all().map(r=>expressionSchema.parse(JSON.parse(String(r.body))));}
  put(value:unknown){const item=expressionSchema.parse(value);if(isAbsolute(item.file)||item.file.split(/[\\/]/).includes('..'))throw new Error('Expression must be inside asset root');this.store.db.prepare('INSERT INTO expressions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(item.id,JSON.stringify(item));return item;}
  remove(id:string){this.store.db.prepare('DELETE FROM expressions WHERE id=?').run(id);}
  async select(id:string|undefined,scope:string,cooldown:number){
    if(!id||Date.now()-(this.last.get(scope)??0)<cooldown)return null;
    const item=this.list().find(v=>v.id===id&&v.enabled);if(!item)return null;
    try{const root=await realpath(this.root),path=await realpath(resolve(root,item.file)),rel=relative(root,path);
      if(rel.startsWith('..')||isAbsolute(rel)||! /\.(png|jpe?g|gif|webp)$/i.test(path))return null;
      const info=await stat(path);if(!info.isFile()||info.size>10*1024*1024)return null;
      this.last.set(scope,Date.now());return path;
    }catch{return null;}
  }
}
