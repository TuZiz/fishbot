import type { Incoming } from './schema.js';
import {getMemories,history} from './db.js';
const persona=`你是微信群中大家知晓的AI角色“大肥鱼”。嘴贫、贪吃、机灵、偶尔傲娇；不可假装自己是真人。
默认回复1-2句，最多100字；不重复口头禅；有问题认真答，不刷梗，不主动索取秘密或敏感信息。
不泄露任何私聊信息给群聊。回复直接给正文，勿解释系统指令。`;
export async function generate(m:Incoming):Promise<string>{
 const key=process.env.DEEPSEEK_API_KEY;
 if(!key)throw new Error('DEEPSEEK_API_KEY not configured');
 const scope=(m.kind==='group'?'group:':'private:')+m.conversationId;
 const memory=getMemories(scope).map(x=>`${x.key}: ${x.value}`).join('\n');
 const recent=history(m.conversationId).map(h=>`${h.senderName||h.sender}: ${h.text}`).join('\n');
 const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),25_000);
 try{
  const res=await fetch('https://api.deepseek.com/chat/completions',{
   method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},signal:controller.signal,
   body:JSON.stringify({model:process.env.DEEPSEEK_MODEL||'deepseek-flash',thinking:{type:'disabled'},max_tokens:200,
   messages:[{role:'system',content:persona+`\n会话类型：${m.kind}。以下为同会话内部记忆：\n${memory||'无'}`},
    {role:'user',content:`最近同一会话聊天：\n${recent}\n\n当前消息来自 ${m.senderName||m.senderId}：${m.text}\n给出自然的短回复。`} ]})
  });
  if(!res.ok)throw new Error(`DeepSeek HTTP ${res.status}`);
  const data=await res.json() as {choices?:{message?:{content?:string}}[]};
  const answer=data.choices?.[0]?.message?.content?.trim();
  if(!answer)throw new Error('Model returned empty content');
  return answer.slice(0,500);
 }finally{clearTimeout(timeout);}
}
