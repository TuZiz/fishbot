import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {open,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {detectKeys} from '../dist/adapters/wechat/database/crypto.js';
const run=promisify(execFile);
// DPAPI unwrap stays in this process; neither key nor child stdout is logged.
const keyPath=resolve('data/wechat/key.xml');
const {stdout}=await run('powershell.exe',['-NoProfile','-Command',`$s=Import-Clixml -LiteralPath '${keyPath.replaceAll("'","''")}';[Console]::Write([Net.NetworkCredential]::new('', $s).Password)`],{windowsHide:true});
const key=stdout.trim();const storage=(await readFile('data/wechat/storage-path.txt','utf8')).trim();
const checks=[];
for(const folder of ['message','contact','session']){
 for(const file of await readdir(join(storage,folder))){
  if(!file.endsWith('.db')||file.includes('fts'))continue;
  const handle=await open(join(storage,folder,file),'r');
  try{const page=Buffer.alloc(4096);const {bytesRead}=await handle.read(page,0,4096,0);if(bytesRead!==4096)throw Error('short page');
   try{const keys=await detectKeys(page,key);checks.push({database:folder+'/'+file,firstPageHmac:true,keyMode:keys.mode});}catch{checks.push({database:folder+'/'+file,firstPageHmac:false});}
  }finally{await handle.close();}
 }
}
const report={checkedAt:new Date().toISOString(),sourceAccess:'read-only; first 4096 bytes only',keyPrinted:false,checks};
await writeFile('data/wechat/key-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!checks.some(v=>v.firstPageHmac))process.exitCode=1;
