import 'dotenv/config';
import {DeepSeekClient} from '../dist/ai/client.js';
if(!process.env.DEEPSEEK_API_KEY){console.error('Set DEEPSEEK_API_KEY locally before running this paid API probe.');process.exitCode=1;}else{
 const client=new DeepSeekClient(process.env.DEEPSEEK_API_KEY,usage=>console.log(JSON.stringify({event:'provider_usage',...usage})));
 const text=await client.complete({system:'你是大肥鱼，有点懒又贪吃，说话简短自然。',input:'用一句话打个招呼，不超过30字。',model:process.env.DEEPSEEK_MODEL||'deepseek-flash',temperature:0.8,maxTokens:100});
 console.log(JSON.stringify({event:'live_deepseek_reply',text}));
}
