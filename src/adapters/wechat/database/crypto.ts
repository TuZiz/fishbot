import {createDecipheriv,createHmac,pbkdf2 as derive,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const pbkdf2=promisify(derive);
export const PAGE_SIZE=4096;
export interface PageKeys { encryption:Buffer; authentication:Buffer; mode:'raw'|'pbkdf2' }
export async function pageKeys(master:Buffer,salt:Buffer,mode:PageKeys['mode']):Promise<PageKeys>{
  if(master.length!==32||salt.length!==16)throw new Error('Invalid database key or salt length');
  const encryption=mode==='raw'?Buffer.from(master):await pbkdf2(master,salt,256000,32,'sha512');
  const macSalt=Buffer.from(salt.map(v=>v^0x3a));
  return {encryption,authentication:await pbkdf2(encryption,macSalt,2,32,'sha512'),mode};
}
export function verifyPage(page:Buffer,pageNumber:number,keys:PageKeys){
  if(page.length!==PAGE_SIZE||!Number.isInteger(pageNumber)||pageNumber<1)return false;
  const number=Buffer.alloc(4);number.writeUInt32LE(pageNumber);
  const mac=createHmac('sha512',keys.authentication).update(page.subarray(pageNumber===1?16:0,4032)).update(number).digest();
  return timingSafeEqual(mac,page.subarray(4032,4096));
}
export function decryptPage(page:Buffer,pageNumber:number,keys:PageKeys){
  if(!verifyPage(page,pageNumber,keys))throw new Error(`Database page ${pageNumber}: HMAC validation failed`);
  const start=pageNumber===1?16:0;
  const decipher=createDecipheriv('aes-256-cbc',keys.encryption,page.subarray(4016,4032));decipher.setAutoPadding(false);
  const output=Buffer.alloc(PAGE_SIZE);if(pageNumber===1)Buffer.from('SQLite format 3\0').copy(output);
  Buffer.concat([decipher.update(page.subarray(start,4016)),decipher.final()]).copy(output,start);
  return output;
}
export async function detectKeys(firstPage:Buffer,hex:string):Promise<PageKeys>{
  if(!/^[a-f\d]{64}$/i.test(hex))throw new Error('Database key must be 64 hexadecimal characters');
  for(const mode of ['raw','pbkdf2'] as const){const keys=await pageKeys(Buffer.from(hex,'hex'),firstPage.subarray(0,16),mode);if(verifyPage(firstPage,1,keys))return keys;}
  throw new Error('Key mismatch or unsupported database encryption format');
}
