import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {quotedImageMd5,imageCacheParts} from '../src/adapters/wechat/database/image-cache.js';
import {tableFor} from '../src/adapters/wechat/database/messages.js';
import {incomingSchema} from '../src/schema.js';
const md5='1234567890abcdef1234567890abcdef';
const m=incomingSchema.parse({id:'request',kind:'group',conversationId:'synthetic@chatroom',senderId:'friend',text:'美化引用的图片',timestamp:Date.now(),quote:{type:3,senderId:'friend',messageId:'9007199254740999',image:{md5}}});
test('cached originals require exact conversation, sender, 64-bit message ID, type and MD5',()=>{
 const db=new DatabaseSync(':memory:'),table=tableFor(m.conversationId);
 try{
  db.exec(`CREATE TABLE Name2Id(user_name TEXT);INSERT INTO Name2Id VALUES('friend');CREATE TABLE "${table}"(server_id INTEGER,local_type INTEGER,real_sender_id INTEGER,message_content TEXT);`);
  db.prepare(`INSERT INTO "${table}" VALUES(?,3,1,?)`).run(9007199254740999n,`friend:\n<msg><img md5="${md5}"/></msg>`);
  assert.equal(quotedImageMd5(db,m),md5);
  assert.equal(quotedImageMd5(db,{...m,conversationId:'other@chatroom'}),undefined);
  assert.equal(quotedImageMd5(db,{...m,quote:{...m.quote!,senderId:'other'}}),undefined);
  assert.equal(quotedImageMd5(db,{...m,quote:{...m.quote!,messageId:'9007199254740998'}}),undefined);
  assert.equal(quotedImageMd5(db,{...m,quote:{...m.quote!,messageId:'999999999999999999999999'}}),undefined);
  assert.equal(quotedImageMd5(db,{...m,quote:{...m.quote!,image:{md5:'0'.repeat(32)}}}),undefined);
  db.exec(`UPDATE "${table}" SET local_type=1`);assert.equal(quotedImageMd5(db,m),undefined);
 }finally{db.close();}
});
test('cache index excludes thumbnails, traversal and unsafe paths, orders HD first',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE dir2id(username TEXT);INSERT INTO dir2id VALUES(\'safe\'),(\'2026-11\'),(\'../escape\');CREATE TABLE image_hardlink_info_v4(md5 TEXT,file_name TEXT,dir1 INTEGER,dir2 INTEGER);');
  const insert=db.prepare('INSERT INTO image_hardlink_info_v4 VALUES(?,?,?,2)');
  for(const file of ['image.dat','image_t.dat','image_h.dat','../bad.dat','C:bad.dat','other.png'])insert.run(md5,file,1);
  insert.run(md5,'escape.dat',3);insert.run('0'.repeat(32),'unrelated.dat',1);
  assert.deepEqual(imageCacheParts(db,md5),[['safe','2026-11','image_h.dat'],['safe','2026-11','image.dat']]);
 }finally{db.close();}
});
