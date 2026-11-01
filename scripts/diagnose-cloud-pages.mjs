import { readFile, open, stat } from 'node:fs/promises';
import { detectKeys, verifyPage, PAGE_SIZE } from '../dist/adapters/wechat/database/crypto.js';
const source=process.env.CLOUD_DB_PATH,keyPath=process.env.CLOUD_DB_KEY_FILE;
if(!source||!keyPath)throw new Error('Cloud diagnostic paths are required');
const key=(await readFile(keyPath,'utf8')).trim(),before=await stat(source),input=await open(source,'r');
const report={readOnly:true,pageSize:PAGE_SIZE,fileBytes:before.size,pageCount:Math.floor(before.size/PAGE_SIZE),firstPageValid:false,validPages:0,firstInvalidPages:[],sampledPageHeaders:[],fileChanged:false};
try{
 const first=Buffer.alloc(PAGE_SIZE);await input.read(first,0,PAGE_SIZE,0);const keys=await detectKeys(first,key);report.firstPageValid=true;report.keyMode=keys.mode;
 for(let pageNumber=1;pageNumber<=report.pageCount;pageNumber++){
  const page=Buffer.alloc(PAGE_SIZE),read=await input.read(page,0,PAGE_SIZE,(pageNumber-1)*PAGE_SIZE);
  if(read.bytesRead!==PAGE_SIZE)throw new Error('Database page changed while reading');
  if(verifyPage(page,pageNumber,keys))report.validPages++;
  else if(report.firstInvalidPages.length<32)report.firstInvalidPages.push(pageNumber);
  if([1,2,3,711,712,713,report.pageCount].includes(pageNumber))report.sampledPageHeaders.push({pageNumber,signature:page.subarray(0,16).toString('hex')});
 }
 const after=await stat(source);report.fileChanged=before.size!==after.size||before.mtimeMs!==after.mtimeMs;
}catch(error){report.error=error instanceof Error?error.message:'Page diagnostic failed';}
finally{await input.close();}
console.log(JSON.stringify(report));
