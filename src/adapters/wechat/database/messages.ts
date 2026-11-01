import {createHash} from 'node:crypto';
import {zstdDecompressSync} from 'node:zlib';
import type {DatabaseSync} from 'node:sqlite';
import type {Incoming} from '../../../schema.js';
import {parseImageXml,parseQuoteXml} from './media-message.js';
export const tableFor=(id:string)=>'Msg_'+createHash('md5').update(id).digest('hex');
export const initialCursor=(maxLocalId:number,tableWasAbsentAtWatchStart:boolean)=>tableWasAbsentAtWatchStart?0:maxLocalId;
export function decodeText(value:unknown):string {
  if(typeof value==='string')return value;
  if(!(value instanceof Uint8Array))throw new Error('Unsupported message encoding');
  let bytes=Buffer.from(value);
  if(bytes.length>=4&&bytes.readUInt32LE(0)===0xfd2fb528)bytes=zstdDecompressSync(bytes,{maxOutputLength:1024*1024});
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export function readNewMessages(db:DatabaseSync,conversationId:string,after:number,selfId:string,shard:string,pendingSelfIds:number[]=[]){
  const table=tableFor(conversationId),kind=conversationId.endsWith('@chatroom')?'group':'private';
  if(pendingSelfIds.length>200||pendingSelfIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('Invalid pending self-message checkpoint');
  const pending=new Set(pendingSelfIds),extra=pending.size?` OR m.local_id IN (${[...pending].map(()=>'?').join(',')})`:'';
  const stmt=db.prepare(`SELECT m.*,n.user_name AS sender FROM "${table}" m LEFT JOIN Name2Id n ON n.rowid=m.real_sender_id WHERE m.local_id>?${extra} ORDER BY m.local_id LIMIT 400`);stmt.setReadBigInts(true);
  const rows=stmt.all(after,...pending);const messages:Incoming[]=[];let cursor=after,skipped=0;
  for(const row of rows){const localId=Number(row.local_id);cursor=Math.max(cursor,localId);pending.delete(localId);const type=Number(BigInt(row.local_type as bigint)&0xffffffffn);if(![1,3,49].includes(type)||typeof row.sender!=='string'){skipped++;continue;}
    const server=String(row.server_id),id=server!=='0'?server:`${shard}:${table}:${localId}`;
    // Image uploads can insert an empty body before both the server ID and MD5 arrive.
    // Retain the row before parsing it, otherwise its later receipt is lost behind the cursor.
    if(server==='0'&&row.sender===selfId){pending.add(localId);continue;}
    let text:string,source:string;try{text=decodeText(row.message_content);source=row.source?decodeText(row.source):'';}catch{skipped++;continue;}
    if(kind==='group'&&text.startsWith(row.sender+':\n'))text=text.slice(row.sender.length+2);
    const image=type===3?parseImageXml(text):undefined;
    const quoted=type===49?parseQuoteXml(text,conversationId):undefined;
    if(type===3){if(!image){if(row.sender===selfId)pending.add(localId);skipped++;continue;}text='[图片]';}
    if(type===49){if(!quoted){skipped++;continue;}text=quoted.text;}
    const at=/<atuserlist>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/atuserlist>/.exec(source);const mentioned=(at?.[1]??at?.[2]??'').split(',').map(v=>v.trim()).includes(selfId);
    if(!text.trim()||text.length>5000){skipped++;continue;}
    // An outgoing row can precede its server ID. Keep its local ID for later
    // snapshots instead of advancing past the only usable delivery receipt.
    messages.push({id,kind,conversationId,senderId:row.sender,text,timestamp:Number(row.create_time)*1000,mentionedBot:mentioned,replyToBot:quoted?.quote.senderId===selfId,isSelf:row.sender===selfId,source:'wechat-database',...(image?{image}:{}),...(quoted?{quote:quoted.quote}:{})});
  }
  if(pending.size>200)throw Error('Too many outgoing rows awaiting server IDs');
  return {messages,cursor,skipped,pendingSelfIds:[...pending]};
}

