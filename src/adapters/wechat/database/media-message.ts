import {XMLParser,XMLValidator} from 'fast-xml-parser';

const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',parseTagValue:false,parseAttributeValue:false,trimValues:true});
function xml(value:string):any|null {
  if(value.length>256*1024||/<!DOCTYPE|<!ENTITY/i.test(value))return null;
  try{if(XMLValidator.validate(value)!==true)return null;return parser.parse(value);}catch{return null;}
}
function scalar(value:unknown):string|undefined{return typeof value==='string'?value:undefined;}
export interface ImageMetadata {md5:string}
export interface QuoteMetadata {messageId:string;senderId:string;type:number;image?:ImageMetadata}
export function parseImageXml(value:string):ImageMetadata|undefined {
  const img=xml(value)?.msg?.img;
  const md5=scalar(img?.['@md5']);return md5&&/^[a-f0-9]{32}$/i.test(md5)?{md5:md5.toLowerCase()}:undefined;
}
export function parseQuoteXml(value:string,conversationId?:string):{text:string;quote:QuoteMetadata}|undefined {
  const app=xml(value)?.msg?.appmsg;
  if(scalar(app?.type)!=='57')return;
  const refer=app.refermsg,text=scalar(app.title),messageId=scalar(refer?.svrid),from=scalar(refer?.fromusr),type=Number(scalar(refer?.type));
  // Group quotations can identify the room in fromusr and the author in
  // chatusr. Only interpret this shape within that exact room; the original
  // DB row still independently verifies author, message ID, type and MD5.
  const senderId=conversationId?.endsWith('@chatroom')&&from===conversationId?scalar(refer?.chatusr):from;
  if(!text?.trim()||text.length>5000||!messageId||!/^[1-9]\d{0,23}$/.test(messageId)||!senderId||senderId.length>256||!Number.isInteger(type))return;
  const image=type===3?parseImageXml(scalar(refer.content)??''):undefined;
  return {text,quote:{messageId,senderId,type,...(image?{image}:{})}};
}
