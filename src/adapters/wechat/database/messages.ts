import {createHash} from 'node:crypto';
import {zstdDecompressSync} from 'node:zlib';
import type {DatabaseSync} from 'node:sqlite';
import type {Incoming} from '../../../schema.js';
export const tableFor=(id:string)=>'Msg_'+createHash('md5').update(id).digest('hex');
export function decodeText(value:unknown):string {
  if(typeof value==='string')return value;
  if(!(value instanceof Uint8Array))throw new Error('Unsupported message encoding');
  let bytes=Buffer.from(value);
  if(bytes.length>=4&&bytes.readUInt32LE(0)===0xfd2fb528)bytes=zstdDecompressSync(bytes,{maxOutputLength:1024*1024});
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export function readNewMessages(db:DatabaseSync,conversationId:string,after:number,selfId:string,shard:string){
  const table=tableFor(conversationId),kind=conversationId.endsWith('@chatroom')?'group':'private';
  const stmt=db.prepare(`SELECT m.*,n.user_name AS sender FROM "${table}" m LEFT JOIN Name2Id n ON n.rowid=m.real_sender_id WHERE m.local_id>? ORDER BY m.local_id LIMIT 200`);stmt.setReadBigInts(true);
  const rows=stmt.all(after);const messages:Incoming[]=[];let cursor=after,skipped=0;
  for(const row of rows){cursor=Number(row.local_id);const type=Number(BigInt(row.local_type as bigint)&0xffffffffn);if(type!==1||typeof row.sender!=='string'){skipped++;continue;}
    let text:string,source:string;try{text=decodeText(row.message_content);source=row.source?decodeText(row.source):'';}catch{skipped++;continue;}
    if(kind==='group'&&text.startsWith(row.sender+':\n'))text=text.slice(row.sender.length+2);
    const at=/<atuserlist>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/atuserlist>/.exec(source);const mentioned=(at?.[1]??at?.[2]??'').split(',').map(v=>v.trim()).includes(selfId);
    const server=String(row.server_id),id=server!=='0'?server:`${shard}:${table}:${cursor}`;
    if(!text.trim()||text.length>5000){skipped++;continue;}
    messages.push({id,kind,conversationId,senderId:row.sender,text,timestamp:Number(row.create_time)*1000,mentionedBot:mentioned,replyToBot:false,isSelf:row.sender===selfId,source:'wechat-database'});
  }
  return {messages,cursor,skipped};
}

