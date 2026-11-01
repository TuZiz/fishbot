import type {DatabaseSync} from 'node:sqlite';
import type {Incoming} from '../../../schema.js';
import {tableFor,decodeText} from './messages.js';
import {parseImageXml} from './media-message.js';

/** Resolve the quoted row in its actual conversation, never trust quoted XML paths/MD5 alone. */
export function quotedImageMd5(db:DatabaseSync,message:Incoming):string|undefined {
  const quote=message.quote;
  if(quote?.type!==3||!quote.senderId||!/^[1-9]\d{0,23}$/.test(quote.messageId))return;
  if(BigInt(quote.messageId)>9223372036854775807n)return;
  const table=tableFor(message.conversationId);
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))return;
  const statement=db.prepare(`SELECT m.local_type,m.message_content,n.user_name AS sender FROM "${table}" m LEFT JOIN Name2Id n ON n.rowid=m.real_sender_id WHERE m.server_id=? LIMIT 2`);
  statement.setReadBigInts(true);
  const rows=statement.all(BigInt(quote.messageId));
  if(rows.length!==1)return;
  const row=rows[0]!;
  if(row.sender!==quote.senderId||Number(BigInt(row.local_type as bigint)&0xffffffffn)!==3)return;
  let xml=decodeText(row.message_content);
  if(message.kind==='group'&&xml.startsWith(row.sender+':\n'))xml=xml.slice(String(row.sender).length+2);
  const image=parseImageXml(xml);
  if(!image||quote.image&&quote.image.md5!==image.md5)return;
  return image.md5;
}

export function imageCacheParts(db:DatabaseSync,md5:string):string[][] {
  if(!/^[a-f0-9]{32}$/.test(md5))return [];
  const rows=db.prepare('SELECT h.file_name,a.username AS dir1,b.username AS dir2 FROM image_hardlink_info_v4 h LEFT JOIN dir2id a ON h.dir1=a.rowid LEFT JOIN dir2id b ON h.dir2=b.rowid WHERE h.md5=? OR lower(hex(h.md5))=? LIMIT 12').all(md5,md5);
  return rows.flatMap(row=>{
    const parts=[row.dir1,row.dir2,row.file_name];
    if(parts.some(v=>typeof v!=='string'||!v||v==='.'||v.includes('..')||/[\\/:\x00]/.test(v)))return [];
    const file=String(row.file_name);
    // A thumbnail is not the referenced original. Prefer downloaded HD, then standard.
    if(!/\.dat$/i.test(file)||/_t\.dat$/i.test(file))return [];
    return [parts as string[]];
  }).sort((a,b)=>Number(/_h\.dat$/i.test(b[2]!))-Number(/_h\.dat$/i.test(a[2]!)));
}
