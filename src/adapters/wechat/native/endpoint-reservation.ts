import {createServer,type Server} from 'node:net';

/** Reserve the experiment port before changing scope files or attaching hooks. */
export async function reserveNativeEndpoint(port:number):Promise<Server>{
  // Startup probes must not leave unread TCP sockets that prevent close().
  const server=createServer(socket=>socket.destroy());
  await new Promise<void>((resolve,reject)=>{
    const failed=(error:Error)=>{server.removeListener('listening',ready);reject(error);};
    const ready=()=>{server.removeListener('error',failed);resolve();};
    server.once('error',failed);server.once('listening',ready);
    server.listen({host:'127.0.0.1',port,exclusive:true});
  });
  return server;
}
