import test from 'node:test';
import assert from 'node:assert/strict';
import {connect,type AddressInfo,type Server} from 'node:net';
import {reserveNativeEndpoint} from '../src/adapters/wechat/native/endpoint-reservation.js';
const close=(server:Server)=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));

test('startup port reservation closes health probe sockets before handoff',async()=>{
  const server=await reserveNativeEndpoint(0),port=(server.address() as AddressInfo).port;
  const socket=connect({host:'127.0.0.1',port});socket.on('error',()=>{});
  try{
    await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
    socket.write('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n');
    let timeout:NodeJS.Timeout|undefined;
    try{await Promise.race([close(server),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('Port handoff hung on startup probe')),1000);})]);}finally{clearTimeout(timeout);}
    assert.equal(server.listening,false);
    const successor=await reserveNativeEndpoint(port);await close(successor);
  }finally{socket.destroy();if(server.listening)await close(server);}
});
test('an occupied native endpoint rejects a second runner before side effects',async()=>{
  const server=await reserveNativeEndpoint(0);
  try{await assert.rejects(reserveNativeEndpoint((server.address() as AddressInfo).port),{code:'EADDRINUSE'});}finally{await close(server);}
});
