import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/core/application.js';
import { environmentSchema } from '../src/config/environment.js';
test('admin auth, hot settings, private and multiplayer group mock workflow, pause and memory management',async()=>{
 const env=environmentSchema.parse({INGEST_TOKEN:'local-integration-test-token-123',DB_PATH:':memory:',DRY_RUN:'false',TEST_SCOPES:'[["private","p"],["group","g"]]'});
 let calls=0;const runtime=await createApplication(env,{async complete(r){calls++;if(r.system.includes('群聊参与决策器'))return JSON.stringify({shouldReply:true,replyTo:'u2',reason:'被@',confidence:0.99,replyType:'both',topic:'午饭'});return JSON.stringify({text:`鱼的回复${calls}`,expressionId:'missing'});}});
 const {app,engine,adapter}=runtime;const headers={'x-fishbot-token':env.INGEST_TOKEN};
 try{
 assert.equal((await app.inject('/api/settings')).statusCode,401);assert.equal((await app.inject('/')).statusCode,200);assert.equal((await app.inject('/admin.js')).statusCode,200);
 let s=(await app.inject({url:'/api/settings',headers})).json();s.mergeMs=10;await app.inject({url:'/api/settings',method:'PUT',headers,payload:s});
 const msg={id:'p1',kind:'private',conversationId:'p',senderId:'u1',text:'吃饭了吗',timestamp:Date.now()};
 assert.equal((await app.inject({url:'/ingest',method:'POST',headers,payload:{...msg,conversationId:'forbidden'}})).statusCode,403);
 assert.equal((await app.inject({url:'/ingest',method:'POST',headers,payload:msg})).json().accepted,true);await engine.idle();assert.equal(adapter.sent.length,1);
 assert.equal((await app.inject({url:'/ingest',method:'POST',headers,payload:msg})).json().accepted,false);
 for(const [id,senderId] of [['g1','u1'],['g2','u2']])await app.inject({url:'/ingest',method:'POST',headers,payload:{...msg,id,kind:'group',conversationId:'g',senderId,mentionedBot:true}});
 await engine.idle();assert.equal(adapter.sent.length,2);assert.equal(adapter.sent[1]!.targetId,'g');
 await app.inject({url:'/control',method:'POST',headers,payload:{paused:true}});await app.inject({url:'/ingest',method:'POST',headers,payload:{...msg,id:'p2'}});await engine.idle();assert.equal(adapter.sent.length,2);
 const scope='["private","p"]';assert.equal((await app.inject({url:'/api/memory',method:'PUT',headers,payload:{scope,subject:'u1',key:'称呼',value:'小王',sourceId:'manual'}})).statusCode,200);
 assert.equal((await app.inject({url:'/api/memory?scope='+encodeURIComponent(scope),headers})).json().people.length,1);
 await app.inject({url:'/api/memory',method:'DELETE',headers,payload:{scope}});assert.equal((await app.inject({url:'/api/memory?scope='+encodeURIComponent(scope),headers})).json().people.length,0);
 assert.equal((await app.inject({url:'/api/settings',method:'PUT',headers,payload:{model:''}})).statusCode,400);
 }finally{await app.close();}
});
