// IPC fixture only: does not load Frida or access WeChat.
import {createInterface} from 'node:readline';
const mode=process.argv[2];
const emit=value=>console.log(JSON.stringify(value));
if(mode==='fatal')emit({event:'fatal'});else if(mode==='invalid')console.log('not-json');else emit({event:'ready'});
createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);
  if(request.op==='stop')process.exit(0);
  if(mode==='detach'&&request.op==='send'){emit({event:'agent-error'});return;}
  emit({id:request.id,result:request.op==='status'?{ready:true,busy:false,expiresAt:0}:{attempted:true,nativeReturned:true}});
});
