import {readOwnedImage} from '../../../images/owned-file.js';
import {createHash} from 'node:crypto';
import type {NativeOutcome} from './bridge.js';
import type {Incoming} from '../../../schema.js';
import type {WechatAdapter,SendResult} from '../contract.js';
import type {NativeBridgePort} from './bridge.js';
export interface MemoInbox {
  sessions:{id:string;kind:string;name:string}[];
  status:{running:boolean;baselines:number;baselineIds:string[];error:string|null;failureCount?:number;lastFailure?:{at:number;reason:string}|null};
  start():void;watch(ids:string[]):void;close():Promise<void>;
  onMessage(handler:(message:Incoming)=>void):()=>unknown;
}
export const MEMO_TEST_PREFIX='鱼测试：';
export interface NativeTestTarget {id:string;kind:'private'|'group';name:string;selfTest:boolean}
export class NativeMemoAdapter implements WechatAdapter {
  private targets:NativeTestTarget[];
  private handlers=new Set<(message:Incoming)=>void>();
  private connected=false;
  private imageReady=false;
  private inFlight=false;
  private unsubscribe?:()=>unknown;
  private sequence=0;
  private receipt?:{target:string;text?:string;md5?:string;after:number;resolve:(value:SendResult)=>void;timer:NodeJS.Timeout};
  constructor(private target:string,private bridge:NativeBridgePort,private inbox:MemoInbox,private confirmationMs=11000,extraTargets:NativeTestTarget[]=[],privateSelfTestOnly=true,private targetName='备忘录',private catalogMode=false,private imagesEnabled=false){this.targets=[{id:target,kind:'private',name:targetName,selfTest:privateSelfTestOnly},...extraTargets];if(new Set(this.targets.map(t=>t.id)).size!==this.targets.length)throw Error('Duplicate native test target');}
  get supportsGeneratedImages(){return this.imagesEnabled&&this.imageReady&&!!this.bridge.sendImage;}
  async connect(){
    if(this.connected)return;
    try{
      this.inbox.start();
      const expires=Date.now()+30000;
      while(!this.inbox.sessions.length&&Date.now()<expires){if(this.inbox.status.error)throw new Error('Memo inbox initialization failed');await new Promise(r=>setTimeout(r,100));}
      const memo=this.inbox.sessions.filter(s=>(this.catalogMode?s.id===this.target:s.name===this.targetName)&&s.kind==='private');
      if(memo.length!==1||memo[0].id!==this.target)throw new Error('Expected the verified private memo conversation');
      for(const target of this.targets){const matches=this.inbox.sessions.filter(s=>(this.catalogMode?s.id===target.id:s.name===target.name)&&s.kind===target.kind);if(matches.length!==1||matches[0].id!==target.id)throw Error('Ambiguous or changed native test target');}
      this.inbox.watch(this.targets.map(t=>t.id));
      const baselined=()=>this.targets.every(t=>this.inbox.status.baselineIds.includes(t.id));
      while(!baselined()&&Date.now()<expires){if(this.inbox.status.error||!this.inbox.status.running)throw new Error('Memo inbox baseline failed');await new Promise(r=>setTimeout(r,100));}
      if(!baselined())throw new Error('Memo inbox baseline timeout');
      this.unsubscribe=this.inbox.onMessage(message=>this.receive(message));
      await this.bridge.start();this.imageReady=(await this.bridge.status()).imagesSupported===true;this.connected=true;
    }catch(error){await this.bridge.stop();await this.inbox.close();this.unsubscribe?.();throw error;}
  }
  private receive(message:Incoming){
    const sequence=++this.sequence;
    const target=this.targets.find(t=>t.id===message.conversationId&&t.kind===message.kind);if(!target)return;
    const receipt=this.receipt;
    if(receipt&&message.isSelf&&message.conversationId===receipt.target&&sequence>receipt.after&&(receipt.md5?message.image?.md5===receipt.md5:!message.image&&message.text===receipt.text)){
      // Consume every matching outbound echo before evaluating self-test commands.
      if(/^[1-9]\d+$/.test(message.id)){clearTimeout(receipt.timer);this.receipt=undefined;receipt.resolve({status:'sent',messageId:message.id,reason:'native send confirmed in local WeChat database'});}return;
    }
    if(!message.isSelf&&!target.selfTest){for(const handler of this.handlers)handler(message);return;}
    if(this.catalogMode||!message.isSelf||!message.text.startsWith(MEMO_TEST_PREFIX))return;
    const text=message.text.slice(MEMO_TEST_PREFIX.length).trim();if(!text)return;
    for(const handler of this.handlers)handler({...message,text,isSelf:false,source:'wechat-native-memo-self-test'});
  }
  onMessage(handler:(message:Incoming)=>void){this.handlers.add(handler);}
  async getStatus(){let ready=false,expiresAt=0,bridgeAvailable=false,requiresChatWindow=true,context={};try{const status=await this.bridge.status();ready=status.ready;this.imageReady=status.imagesSupported===true;expiresAt=status.expiresAt;bridgeAvailable=true;requiresChatWindow=status.requiresChatWindow!==false;context=status;}catch{}return {connected:this.connected&&ready&&this.inbox.status.running&&!this.inbox.status.error,backend:requiresChatWindow?'native-memo-experimental':'wechat-native-windowless',realWechat:true,testOnly:!this.catalogMode,requiresChatWindow,nativeReady:ready,bridgeAvailable,expiresAt,context,scope:'explicit memo test targets; live QObject lifecycle guard',targetKinds:this.targets.map(t=>t.kind),inboxError:this.inbox.status.error,lastInboxFailure:this.inbox.status.lastFailure,inboxFailureCount:this.inbox.status.failureCount};}
  async sendText(targetId:string,content:string):Promise<SendResult>{
    if(!this.targets.some(t=>t.id===targetId)||!this.connected||this.inFlight)return {status:'not-sent',reason:'outside test scope, disconnected or busy'};
    if(!this.inbox.status.running||this.inbox.status.error||!this.inbox.status.baselineIds.includes(targetId))return {status:'not-sent',reason:'database confirmation observer unavailable'};
    if(!content.trim()||content.length>5000)return {status:'not-sent',reason:'invalid text'};
    if(content.startsWith(MEMO_TEST_PREFIX))return {status:'not-sent',reason:'self-test command echo blocked'};
    return this.sendConfirmed(targetId,{text:content},()=>this.bridge.send(targetId,content));
  }
  private async sendConfirmed(targetId:string,expected:{text?:string;md5?:string},operation:()=>Promise<NativeOutcome>):Promise<SendResult>{
    if(!this.targets.some(t=>t.id===targetId)||!this.connected||this.inFlight||!this.inbox.status.running||this.inbox.status.error||!this.inbox.status.baselineIds.includes(targetId))return {status:'not-sent',reason:'Native scope, transport or observer unavailable'};
    this.inFlight=true;
    let resolveReceipt!:(value:SendResult)=>void;
    const receiptPromise=new Promise<SendResult>(resolve=>{resolveReceipt=resolve;});
    const timer=setTimeout(()=>{this.receipt=undefined;resolveReceipt({status:'unknown',reason:'no new confirmed database echo; do not resend automatically'});},expected.md5?Math.max(45000,this.confirmationMs):this.confirmationMs);
    this.receipt={target:targetId,...expected,after:this.sequence,resolve:resolveReceipt,timer};
    try{
      const result=await operation();
      if(!result.attempted){clearTimeout(timer);this.receipt=undefined;return {status:'not-sent',reason:result.error??'native guard rejected before sending'};}
      if(!result.nativeReturned||result.cleanupError){clearTimeout(timer);this.receipt=undefined;return {status:'unknown',reason:'native call or cleanup incomplete; do not resend'};}
      return await receiptPromise;
    }catch{clearTimeout(timer);this.receipt=undefined;return {status:'unknown',reason:'native transport outcome unavailable; do not resend'};}
    finally{this.inFlight=false;}
  }
  async sendImage(targetId:string,imagePath:string):Promise<SendResult>{
    if(!this.supportsGeneratedImages)return {status:'not-sent',reason:'native images have not been verified'};
    const image=await readOwnedImage(imagePath);if(!image)return {status:'not-sent',reason:'Generated image unavailable, invalid or outside owned directory'};
    const {path,bytes}=image,md5=createHash('md5').update(bytes).digest('hex');
    return this.sendConfirmed(targetId,{md5},()=>this.bridge.sendImage!(targetId,path,bytes.length,md5));
  }
  async disconnect(){this.connected=false;this.imageReady=false;this.unsubscribe?.();this.unsubscribe=undefined;if(this.receipt){clearTimeout(this.receipt.timer);this.receipt.resolve({status:'unknown',reason:'adapter stopped during confirmation'});this.receipt=undefined;}await this.bridge.stop();await this.inbox.close();this.handlers.clear();}
}
