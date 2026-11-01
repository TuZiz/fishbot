import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes,createCipheriv,createHmac} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {pageKeys,verifyPage,decryptPage,detectKeys} from '../src/adapters/wechat/database/crypto.js';import {initialCursor,readNewMessages,tableFor,decodeText} from '../src/adapters/wechat/database/messages.js';import {committedWal,snapshotDatabase} from '../src/adapters/wechat/database/snapshot.js';
test('database page HMAC rejects wrong key and tampering; CBC decrypt restores authenticated payload',async()=>{
 const master=randomBytes(32),salt=randomBytes(16),keys=await pageKeys(master,salt,'raw'),page=Buffer.alloc(4096);salt.copy(page);const iv=randomBytes(16);iv.copy(page,4016);const content=randomBytes(4000);const cipher=createCipheriv('aes-256-cbc',keys.encryption,iv);cipher.setAutoPadding(false);Buffer.concat([cipher.update(content),cipher.final()]).copy(page,16);const number=Buffer.alloc(4);number.writeUInt32LE(1);createHmac('sha512',keys.authentication).update(page.subarray(16,4032)).update(number).digest().copy(page,4032);
 assert.equal(verifyPage(page,1,keys),true);assert.equal((await detectKeys(page,master.toString('hex'))).mode,'raw');const plain=decryptPage(page,1,keys);assert.equal(plain.subarray(0,16).toString(),'SQLite format 3\0');assert.ok(plain.subarray(16,4016).equals(content));const corrupt=Buffer.from(page);corrupt[60]^=1;assert.throws(()=>decryptPage(corrupt,1,keys),/HMAC/);await assert.rejects(detectKeys(page,randomBytes(32).toString('hex')));assert.throws(()=>committedWal(Buffer.alloc(32)),/magic/);
});
test('database rows preserve 64-bit IDs and stable member identity; no invented quote detection',()=>{
 const db=new DatabaseSync(':memory:'),id='test@chatroom',table=tableFor(id);db.exec(`CREATE TABLE Name2Id(user_name TEXT);INSERT INTO Name2Id VALUES('self'),('member');CREATE TABLE "${table}"(local_id INTEGER,server_id INTEGER,local_type INTEGER,real_sender_id INTEGER,create_time INTEGER,message_content TEXT,source TEXT);`);
 db.prepare(`INSERT INTO "${table}" VALUES(?,?,?,?,?,?,?)`).run(1,9007199254740999n,1,2,1700000000,'member:\n测试文本','<atuserlist><![CDATA[self]]></atuserlist>');
 const result=readNewMessages(db,id,0,'self','message_0.db');assert.equal(result.messages[0]!.id,'9007199254740999');assert.equal(result.messages[0]!.senderId,'member');assert.equal(result.messages[0]!.text,'测试文本');assert.equal(result.messages[0]!.mentionedBot,true);assert.equal(result.messages[0]!.replyToBot,false);assert.equal(readNewMessages(db,id,1,'self','message_0.db').messages.length,0);assert.throws(()=>decodeText(new Uint8Array([255])));db.close();
});
test('first message table created after watch starts at zero while existing tables skip history',()=>{
 assert.equal(initialCursor(500,false),500);
 assert.equal(initialCursor(1,true),0);
});

test('outgoing server ID promotion is reread without delaying newer friend input or replaying old own rows',()=>{
 const db=new DatabaseSync(':memory:'),id='memo',table=tableFor(id);
 try{
  db.exec(`CREATE TABLE Name2Id(user_name TEXT);INSERT INTO Name2Id VALUES('self'),('friend');CREATE TABLE "${table}"(local_id INTEGER,server_id INTEGER,local_type INTEGER,real_sender_id INTEGER,create_time INTEGER,message_content TEXT,source TEXT);`);
  const insert=db.prepare(`INSERT INTO "${table}" VALUES(?,?,?,?,?,?,?)`);
  insert.run(1,11,1,1,1700000000,'old own reply','');
  insert.run(2,0,1,1,1700000001,'pending native reply','');
  insert.run(3,33,1,2,1700000002,'new friend input','');
  const first=readNewMessages(db,id,1,'self','message_0.db');
  assert.deepEqual(first.messages.map(m=>m.id),['33']);assert.equal(first.cursor,3);assert.deepEqual(first.pendingSelfIds,[2]);
  const waiting=readNewMessages(db,id,first.cursor,'self','message_0.db',first.pendingSelfIds);
  assert.equal(waiting.messages.length,0);assert.equal(waiting.cursor,3);assert.deepEqual(waiting.pendingSelfIds,[2]);
  db.prepare(`UPDATE "${table}" SET server_id=? WHERE local_id=2`).run(9007199254740999n);
  const promoted=readNewMessages(db,id,waiting.cursor,'self','message_0.db',waiting.pendingSelfIds);
  assert.deepEqual(promoted.messages.map(m=>m.id),['9007199254740999']);assert.equal(promoted.messages[0]!.isSelf,true);
  assert.equal(promoted.cursor,3);assert.deepEqual(promoted.pendingSelfIds,[]);
  assert.equal(readNewMessages(db,id,promoted.cursor,'self','message_0.db',promoted.pendingSelfIds).messages.length,0);
 }finally{db.close();}
});

test('read-only snapshot ignores only authenticated SQLite zero-filled preallocation tail',async()=>{
 const {mkdtemp,writeFile,readFile,stat,rm}=await import('node:fs/promises');const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const folder=await mkdtemp(join(tmpdir(),'fishbot-padded-db-')),source=join(folder,'source.db'),destination=join(folder,'snapshot.db');
 const master=randomBytes(32),salt=randomBytes(16),keys=await pageKeys(master,salt,'raw');
 const page=Buffer.alloc(4096);salt.copy(page);const plain=Buffer.alloc(4000);plain.writeUInt16BE(4096,0);plain.writeUInt32BE(1,12);plain.writeUInt16BE(4096,16);
 const iv=randomBytes(16);iv.copy(page,4016);const cipher=createCipheriv('aes-256-cbc',keys.encryption,iv);cipher.setAutoPadding(false);Buffer.concat([cipher.update(plain),cipher.final()]).copy(page,16);
 const macPage=Buffer.from(page);macPage.fill(0,4032);const number=Buffer.alloc(4);number.writeUInt32LE(1);createHmac('sha512',keys.authentication).update(macPage.subarray(16,4032)).update(number).digest().copy(page,4032);
 try{
  await writeFile(source,Buffer.concat([page,Buffer.alloc(4096*4)]));
  await snapshotDatabase(source,destination,master.toString('hex'));
  const result=await readFile(destination);assert.equal(result.length,4096);assert.equal(result.subarray(0,16).toString(),'SQLite format 3\0');assert.equal(result.readUInt32BE(28),1);
  assert.equal((await stat(source)).size,4096*5,'source database remains untouched');
  const corrupt=Buffer.from(await readFile(source));corrupt[4096*4]=1;await writeFile(source,corrupt);
  await assert.rejects(snapshotDatabase(source,join(folder,'corrupt.db'),master.toString('hex')),/Non-zero data follows/);
 }finally{await rm(folder,{recursive:true,force:true});}
});
