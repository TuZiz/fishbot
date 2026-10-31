import 'dotenv/config';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createApplication} from '../dist/core/application.js';
import {environmentSchema} from '../dist/config/environment.js';
const env=environmentSchema.parse({...process.env,DB_PATH:':memory:',DRY_RUN:'false',TEST_SCOPES:'[["private","live-private-test"],["group","live-group-test"]]'});
const runtime=await createApplication(env);
try{
 runtime.settings.save({...runtime.settings.get(),mergeMs:20,memoryEnabled:false});
 const base={senderId:'tester-a',senderName:'测试成员甲',timestamp:Date.now(),mentionedBot:false,replyToBot:false,isSelf:false,source:'live-api-mock-probe'};
 runtime.adapter.receive({...base,id:'private-1',kind:'private',conversationId:'live-private-test',text:'大肥鱼，简单回答：7加8等于多少？'});
 await runtime.engine.idle();
 assert.equal(runtime.adapter.sent.length,1,'private generation did not reach MockAdapter');
 assert.match(runtime.adapter.sent[0].content,/15|十五/);
 runtime.adapter.receive({...base,timestamp:Date.now(),id:'group-1',kind:'group',conversationId:'live-group-test',text:'我中午准备吃面，你们呢？'});
 runtime.adapter.receive({...base,timestamp:Date.now(),senderId:'tester-b',senderName:'测试成员乙',id:'group-2',kind:'group',conversationId:'live-group-test',mentionedBot:true,text:'大肥鱼，你觉得甲说的午饭再加个什么配菜好？简单说一句。'});
 await runtime.engine.idle();
 const status=(await runtime.app.inject({url:'/api/status',headers:{'x-fishbot-token':env.INGEST_TOKEN}})).json();
 assert.equal(runtime.adapter.sent.length,2,'group decision/reply did not reach MockAdapter');
 assert.equal(status.errors.length,0,'runtime reported AI errors');
 const report={checkedAt:new Date().toISOString(),model:runtime.settings.get().model,provider:'real DeepSeek API',transport:'MockAdapter only',privatePassed:true,groupPassed:true,realWechatVerified:false,replies:runtime.adapter.sent,usage:status.totals};
 await writeFile('data/live-conversation-report.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await runtime.app.close();}
