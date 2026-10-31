import type {Incoming} from '../../../schema.js';
import type {WechatAdapter,SendResult} from '../contract.js';
import type {NativeBridgePort} from './bridge.js';
export interface MemoInbox {
  sessions:{id:string;kind:string;name:string}[];
  status:{running:boolean;baselines:number;error:string|null};
  start():void;watch(ids:string[]):void;close():Promise<void>;
  onMessage(handler:(message:Incoming)=>void):()=>unknown;
}
export const MEMO_TEST_PREFIX='鱼测试：';
export class NativeMemoAdapter implements WechatAdapter {
  private handlers=new Set<(message:Incoming)=>void>();
  private connected=false;
  private inFlight=false;
  private unsubscribe?:()=>unknown;
  private sequence=0;
  private receipt?:{text:string;after:number;resolve:(value:SendResult)=>void;timer:NodeJS.Timeout};
  constructor(private target:string,private bridge:NativeBridgePort,private inbox:MemoInbox,private confirmationMs=11000){}
  async connect(){
    if(this.connected)return;
    try{
      this.inbox.start();
      const expires=Date.now()+30000;
      while(!this.inbox.sessions.length&&Date.now()<expires){if(this.inbox.status.error)throw new Error('Memo inbox initialization failed');await new Promise(r=>setTimeout(r,100));}
      const memo=this.inbox.sessions.filter(s=>s.name==='备忘录'&&s.kind==='private');
      if(memo.length!==1||memo[0].id!==this.target)throw new Error('Expected the verified private memo conversation');
      this.inbox.watch([this.target]);
      while(!this.inbox.status.baselines&&Date.now()<expires){if(this.inbox.status.error)throw new Error('Memo inbox baseline failed');await new Promise(r=>setTimeout(r,100));}
      if(!this.inbox.status.baselines)throw new Error('Memo inbox baseline timeout');
      this.unsubscribe=this.inbox.onMessage(message=>this.receive(message));
      await this.bridge.start();this.connected=true;
    }catch(error){await this.bridge.stop();await this.inbox.close();this.unsubscribe?.();throw error;}
  }
  private receive(message:Incoming){
    const sequence=++this.sequence;
    if(message.conversationId!==this.target||message.kind!=='private'||!message.isSelf)return;
    const receipt=this.receipt;
    if(receipt&&sequence>receipt.after&&message.text===receipt.text){
      // Consume every matching outbound echo before evaluating self-test commands.
      if(/^[1-9]\d+$/.test(message.id)){clearTimeout(receipt.timer);this.receipt=undefined;receipt.resolve({status:'sent',messageId:message.id,reason:'native send confirmed in local WeChat database'});}return;
    }
    if(!message.text.startsWith(MEMO_TEST_PREFIX))return;
    const text=message.text.slice(MEMO_TEST_PREFIX.length).trim();if(!text)return;
    for(const handler of this.handlers)handler({...message,text,isSelf:false,source:'wechat-native-memo-self-test'});
  }
  onMessage(handler:(message:Incoming)=>void){this.handlers.add(handler);}
  async getStatus(){let ready=false,expiresAt=0,bridgeAvailable=false;try{const status=await this.bridge.status();ready=status.ready;expiresAt=status.expiresAt;bridgeAvailable=true;}catch{}return {connected:this.connected&&ready&&this.inbox.status.running&&!this.inbox.status.error,backend:'native-memo-experimental',realWechat:true,testOnly:true,nativeReady:ready,bridgeAvailable,expiresAt,scope:'verified self memo; 5 minute warmup lease',inboxError:this.inbox.status.error};}
  async sendText(targetId:string,content:string):Promise<SendResult>{
    if(targetId!==this.target||!this.connected||this.inFlight)return {status:'not-sent',reason:'outside memo scope, disconnected or busy'};
    if(!content.trim()||content.length>5000)return {status:'not-sent',reason:'invalid text'};
    if(content.startsWith(MEMO_TEST_PREFIX))return {status:'not-sent',reason:'self-test command echo blocked'};
    this.inFlight=true;
    let resolveReceipt!:(value:SendResult)=>void;
    const receiptPromise=new Promise<SendResult>(resolve=>{resolveReceipt=resolve;});
    const timer=setTimeout(()=>{this.receipt=undefined;resolveReceipt({status:'unknown',reason:'no new confirmed database echo; do not resend automatically'});},this.confirmationMs);
    this.receipt={text:content,after:this.sequence,resolve:resolveReceipt,timer};
    try{
      const result=await this.bridge.send(targetId,content);
      if(!result.attempted){clearTimeout(timer);this.receipt=undefined;return {status:'not-sent',reason:result.error??'native guard rejected before sending'};}
      if(!result.nativeReturned||result.cleanupError){clearTimeout(timer);this.receipt=undefined;return {status:'unknown',reason:'native call or cleanup incomplete; do not resend'};}
      return await receiptPromise;
    }catch{clearTimeout(timer);this.receipt=undefined;return {status:'unknown',reason:'native transport outcome unavailable; do not resend'};}
    finally{this.inFlight=false;}
  }
  async sendImage():Promise<SendResult>{return {status:'not-sent',reason:'native images have not been verified'};}
  async disconnect(){this.connected=false;this.unsubscribe?.();this.unsubscribe=undefined;if(this.receipt){clearTimeout(this.receipt.timer);this.receipt.resolve({status:'unknown',reason:'adapter stopped during confirmation'});this.receipt=undefined;}await this.bridge.stop();await this.inbox.close();this.handlers.clear();}
}
