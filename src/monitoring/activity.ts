export interface ActivityEvent {
  stage:'received'|'processing'|'skipped'|'sending'|'sent'|'dry-run'|'not-sent'|'unknown'|'expired'|'error';
  scope:string;
  text?:string;
  kind?:string;
  messageId?:string;
  sender?:string;
}
export type ActivitySink=(event:ActivityEvent)=>void;
const labels:Record<ActivityEvent['stage'],string>={received:'收到消息',processing:'AI处理中',skipped:'本轮不回复',sending:'开始发送',sent:'发送成功','dry-run':'模拟发送（未实发）','not-sent':'未发送（按队列策略处理）',unknown:'发送结果未知（不自动重发）',expired:'回复过期',error:'处理出错'};

/** One bounded line per event; never print transport payloads or image paths. */
export class TerminalActivity {
  private names=new Map<string,string>();
  constructor(private write:(line:string)=>void=line=>console.log(line),private secrets:string[]=[],private showContent=true){}
  private safe(value:string){
    let text=value;
    for(const secret of this.secrets.filter(s=>s.length>=8))text=text.split(secret).join('[已隐藏]');
    return text.replace(/sk-[a-z0-9_-]{8,}/gi,'[密钥已隐藏]').replace(/\b[a-f0-9]{64}\b/gi,'[密钥已隐藏]').replace(/\b(token|password|secret|api[_ -]?key|密码|口令|验证码)\s*[:=：]\s*\S+/gi,'$1=[已隐藏]').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,800);
  }
  setNames(entries:Iterable<readonly [string,string]>){this.names=new Map(entries);}
  readonly emit:ActivitySink=event=>{
    try{
      const [kind,id]=JSON.parse(event.scope) as [string,string];
      const target=`${kind==='group'?'群聊':'私聊'} ${this.names.get(id)??id}`;
      const body=event.kind==='image'?'[图片]':event.text?(this.showContent?this.safe(event.text):'[内容隐藏]'):'';
      this.write(`[FishBot ${new Date().toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'})}] [${labels[event.stage]}] ${this.safe(target)}${event.sender?` | ${this.safe(event.sender)}`:''}${event.messageId?` | 消息ID=${this.safe(event.messageId)}`:''}${body?` | ${body}`:''}`);
    }catch{/* Diagnostics must never alter delivery or trigger a retry. */}
  };
}
