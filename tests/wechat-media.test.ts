import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseQuoteXml,parseImageXml} from '../src/adapters/wechat/database/media-message.js';
import {readNewMessages,tableFor} from '../src/adapters/wechat/database/messages.js';
import {Store} from '../src/storage/store.js';
import {GeneratedImageReferences} from '../src/images/references.js';
import {incomingSchema} from '../src/schema.js';
const md5='1234567890abcdef1234567890abcdef';
const imageXml=`<msg><img md5="${md5}" aeskey="not-persisted" cdnmidimgurl="not-persisted" /></msg>`;
function quoteXml(sender='self'){return `<msg><appmsg><title><![CDATA[美化引用的图片，改成绿色]]></title><type>57</type><refermsg><type>3</type><svrid>9007199254740999</svrid><fromusr>${sender}</fromusr><content><![CDATA[${imageXml}]]></content></refermsg></appmsg></msg>`;}
test('image/quote parsing preserves 64-bit IDs and drops media secrets',()=>{
 assert.deepEqual(parseImageXml(imageXml),{md5});
 assert.deepEqual(parseQuoteXml(quoteXml()),{text:'美化引用的图片，改成绿色',quote:{messageId:'9007199254740999',senderId:'self',type:3,image:{md5}}});
 assert.equal(parseQuoteXml('<msg><appmsg><type>6</type></appmsg></msg>'),undefined);
 assert.equal(parseQuoteXml(quoteXml().replace('</appmsg>','')),undefined);
 assert.equal(parseImageXml('<!DOCTYPE msg [<!ENTITY x "secret">]>'+imageXml),undefined);
});
test('group quotation uses chatusr only within its exact room and still rejects missing authors',()=>{
 const xml=quoteXml('test@chatroom').replace('</fromusr>','</fromusr><chatusr>friend</chatusr>');
 assert.equal(parseQuoteXml(xml,'test@chatroom')?.quote.senderId,'friend');
 assert.equal(parseQuoteXml(xml,'other@chatroom')?.quote.senderId,'test@chatroom');
 assert.equal(parseQuoteXml(quoteXml('test@chatroom'),'test@chatroom'),undefined);
 assert.equal(parseQuoteXml(quoteXml('friend'),'test@chatroom')?.quote.senderId,'friend');
});
test('database observer emits structured images and quotes, including delayed image server IDs',()=>{
 const db=new DatabaseSync(':memory:'),id='test@chatroom',table=tableFor(id);
 try{db.exec(`CREATE TABLE Name2Id(user_name TEXT);INSERT INTO Name2Id VALUES('self'),('friend');CREATE TABLE "${table}"(local_id INTEGER,server_id INTEGER,local_type INTEGER,real_sender_id INTEGER,create_time INTEGER,message_content TEXT,source TEXT);`);
 const insert=db.prepare(`INSERT INTO "${table}" VALUES(?,?,?,?,?,?,?)`);
 insert.run(1,0,3,1,1700000000,imageXml,'');insert.run(2,33,49,2,1700000001,quoteXml(),'');
 const first=readNewMessages(db,id,0,'self','message_0.db');assert.deepEqual(first.pendingSelfIds,[1]);assert.equal(first.messages[0]!.replyToBot,true);assert.equal(first.messages[0]!.quote?.messageId,'9007199254740999');assert.equal(first.messages[0]!.text,'美化引用的图片，改成绿色');
 db.prepare(`UPDATE "${table}" SET server_id=? WHERE local_id=1`).run(9007199254740999n);
 const second=readNewMessages(db,id,first.cursor,'self','message_0.db',first.pendingSelfIds);assert.equal(second.messages[0]!.image?.md5,md5);assert.equal(second.messages[0]!.id,'9007199254740999');assert.deepEqual(second.pendingSelfIds,[]);
 }finally{db.close();}
});
test('image upload rows with empty bodies remain pending until both ID and MD5 are ready',()=>{
 const db=new DatabaseSync(':memory:'),table=tableFor('filehelper');
 try{db.exec(`CREATE TABLE Name2Id(user_name TEXT);INSERT INTO Name2Id VALUES('self');CREATE TABLE "${table}"(local_id INTEGER,server_id INTEGER,local_type INTEGER,real_sender_id INTEGER,create_time INTEGER,message_content TEXT,source TEXT);`);
 db.prepare(`INSERT INTO "${table}" VALUES(1,0,3,1,1700000000,'','')`).run();
 const pending=readNewMessages(db,'filehelper',0,'self','message_0.db');assert.deepEqual(pending.pendingSelfIds,[1]);assert.equal(pending.messages.length,0);
 db.prepare(`UPDATE "${table}" SET server_id=12345,message_content=?`).run('<msg><img md5="" /></msg>');
 const identified=readNewMessages(db,'filehelper',pending.cursor,'self','message_0.db',pending.pendingSelfIds);assert.deepEqual(identified.pendingSelfIds,[1]);assert.equal(identified.messages.length,0);
 db.prepare(`UPDATE "${table}" SET message_content=?`).run(imageXml);
 const complete=readNewMessages(db,'filehelper',identified.cursor,'self','message_0.db',identified.pendingSelfIds);assert.deepEqual(complete.pendingSelfIds,[]);assert.equal(complete.messages[0]!.id,'12345');assert.deepEqual(complete.messages[0]!.image,{md5});
 }finally{db.close();}
});
test('quoted generated image resolves only a confirmed image in the same conversation and owned directory',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fishbot-reference-')),root=join(dir,'generated'),path=join(root,'a.png'),store=new Store(':memory:');await mkdir(root);const bytes=Buffer.from([137,80,78,71,13,10,26,10]);await writeFile(path,bytes);
 const m=incomingSchema.parse({id:'request',conversationId:'a',kind:'private',senderId:'u',text:'美化引用的图片',timestamp:Date.now(),quote:{messageId:'123',senderId:'self',type:3}});
 try{store.enqueue(m,path,'image');let job=store.pending()[0]!;store.complete(job.id,'sent',{messageId:'123'});const resolver=new GeneratedImageReferences(store,root);
 assert.deepEqual((await resolver.resolve(m))?.bytes,bytes);assert.equal(await resolver.resolve({...m,conversationId:'b'}),undefined);
 const outside=join(dir,'outside.png');await writeFile(outside,bytes);store.db.prepare('UPDATE outbox SET text=? WHERE id=?').run(outside,job.id);assert.equal(await resolver.resolve(m),undefined);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
