import type { Incoming } from '../../../schema.js';
import type { WechatAdapter, SendResult } from '../contract.js';
import { DatabaseObserver } from './observer.js';

export class ReadOnlyDatabaseAdapter implements WechatAdapter {
  private connected=false;
  private handlers=new Set<(message:Incoming)=>void>();
  private unsubscribe?:()=>void;
  constructor(private observer:DatabaseObserver,private scopes:string[]){ }
  async connect(){
    this.observer.start();
    const until=Date.now()+30000;
    while(!this.observer.sessions.length&&Date.now()<until){
      if(this.observer.status.error)throw new Error(this.observer.status.error);
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    this.unsubscribe=this.observer.onMessage(message=>{for(const handler of this.handlers)handler(message);});
    this.connected=true;
    if(this.scopes.length)await this.setScopes(this.scopes);
  }
  async setScopes(scopes:string[]){
    const valid=[...new Set(scopes)].filter(id=>this.observer.sessions.some(s=>s.id===id));
    if(scopes.length&&valid.length!==new Set(scopes).size){
      this.scopes=[];
      if(this.connected)this.observer.watch([]);
      throw new Error('Whitelist contains an unknown cloud conversation');
    }
    this.scopes=valid;
    if(!this.connected)return;
    this.observer.watch(valid);
    if(!valid.length)return;
    const baselineUntil=Date.now()+30000;
    while(this.observer.status.baselineIds.length<valid.length&&Date.now()<baselineUntil){
      if(this.observer.status.error)throw new Error(this.observer.status.error);
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(this.observer.status.baselineIds.length<valid.length)throw new Error('Cloud database baseline timeout');
  }
  onMessage(handler:(message:Incoming)=>void){this.handlers.add(handler);}
  async sendText():Promise<SendResult>{return {status:'not-sent',reason:'cloud WeChat 4.1.15.56 send path is read-only until separately verified'};}
  async sendImage():Promise<SendResult>{return {status:'not-sent',reason:'cloud database adapter does not support image sending'};}
  async getStatus(){return {connected:this.connected&&this.observer.status.running&&!this.observer.status.error,backend:'wechat-database-readonly',realWechat:true,readOnly:true,sessions:this.observer.sessions.length,watched:this.observer.status.baselineIds.length,inboxError:this.observer.status.error};}
  async disconnect(){this.connected=false;this.unsubscribe?.();this.unsubscribe=undefined;await this.observer.close();this.handlers.clear();}
}
