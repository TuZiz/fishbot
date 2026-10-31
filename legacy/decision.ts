import type { Incoming } from './schema.js';
export function shouldReply(m:Incoming, lastReply:number, random=Math.random()):{reply:boolean;reason:string}{
 if(m.isSelf) return {reply:false,reason:'self'};
 if(m.kind==='private')return {reply:true,reason:'private'};
 if(m.mentionedBot||m.replyToBot)return {reply:true,reason:'directed'};
 if(Date.now()-lastReply<120_000)return {reply:false,reason:'cooldown'};
 const probability=Number(process.env.GROUP_REPLY_PROBABILITY??'0.12');
 const p=Number.isFinite(probability)?Math.max(0,Math.min(1,probability)):0.12;
 return {reply:random<p,reason:'ambient'};
}
