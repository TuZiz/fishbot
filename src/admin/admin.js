const $=id=>document.getElementById(id);let token='',settings={};
const show=(id,value)=>$(id).textContent=JSON.stringify(value,null,2);
async function api(path,method='GET',body){const res=await fetch(path,{method,headers:{'x-fishbot-token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await res.json();if(!res.ok)throw Error(data.error||`HTTP ${res.status}`);return data;}
function action(id,fn){$(id).addEventListener('click',()=>run(fn));}
async function run(fn){try{await fn();$('notice').textContent='操作完成';}catch(e){$('notice').textContent=`操作失败：${e.message}`;}}
async function refresh(){show('status',await api('/health'));show('metrics',await api('/api/status'));show('expressionList',await api('/api/expressions'));}
async function load(){settings=await api('/api/settings');$('settings').value=JSON.stringify(settings,null,2);for(const k of ['privateEnabled','groupEnabled','allConversations','memoryEnabled','expressionsEnabled'])$(k).checked=settings[k];$('persona').value=settings.persona;$('model').value=settings.model;await refresh();}
action('connect',async()=>{token=$('token').value;$('token').value='';await load();});action('refresh',refresh);
action('stop',async()=>{await api('/control','POST',{paused:true});await load();});action('resume',async()=>{await api('/control','POST',{paused:false});await load();});
$('settingsForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{const data=JSON.parse($('settings').value);for(const k of ['privateEnabled','groupEnabled','allConversations','memoryEnabled','expressionsEnabled'])data[k]=$(k).checked;data.persona=$('persona').value;data.model=$('model').value;await api('/api/settings','PUT',data);await load();});});
$('chatForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{const m={id:crypto.randomUUID(),kind:$('kind').value,conversationId:$('conversation').value,senderId:$('sender').value,text:$('message').value,timestamp:Date.now(),mentionedBot:$('mention').checked,replyToBot:$('quote').checked,source:'admin-mock'};show('chatResult',await api('/ingest','POST',m));});});
action('replies',async()=>show('chatResult',{queue:await api('/replies'),mockSent:await api('/api/mock/sent')}));
const scope=()=>JSON.stringify(JSON.parse($('scope').value));
action('memoryLoad',async()=>show('memoryResult',await api('/api/memory?scope='+encodeURIComponent(scope()))));
action('forget',async()=>{await api('/api/memory','DELETE',{scope:scope()});show('memoryResult',await api('/api/memory?scope='+encodeURIComponent(scope())));});
$('memoryForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{await api('/api/memory','PUT',{...JSON.parse($('memoryBody').value),scope:scope()});show('memoryResult',await api('/api/memory?scope='+encodeURIComponent(scope())));});});
$('expressionForm').addEventListener('submit',e=>{e.preventDefault();run(async()=>{await api('/api/expressions','PUT',JSON.parse($('expressionBody').value));await refresh();});});
action('expressionDelete',async()=>{await api('/api/expressions/'+encodeURIComponent($('expressionId').value),'DELETE');await refresh();});
fetch('/health').then(r=>r.json()).then(h=>{$('mode').textContent=`${h.adapter.backend} · ${h.dryRun?'DRY RUN':'模拟发送'} · ${h.aiConfigured?'AI 已配置':'AI 未配置'}`;}).catch(()=>{$('mode').textContent='服务不可达';});
async function wechatRefresh(){show('wechatResult',await api('/api/wechat/status'));const sessions=await api('/api/wechat/sessions');const select=$('wechatSession');const previous=select.value;select.replaceChildren();for(const s of sessions){const option=document.createElement('option');option.value=s.id;option.textContent=`${s.kind==='group'?'群':'私聊'} · ${s.name}`;select.append(option);}if([...select.options].some(o=>o.value===previous))select.value=previous;}
action('wechatStart',async()=>{show('wechatResult',await api('/api/wechat/start','POST'));$('notice').textContent='正在读取会话目录，稍后点击刷新会话和状态';});
action('wechatRefresh',wechatRefresh);
action('wechatWatch',async()=>{show('wechatResult',await api('/api/wechat/watch','POST',{ids:[$('wechatSession').value]}));});
action('wechatEvents',async()=>{show('wechatResult',{status:await api('/api/wechat/status'),events:await api('/api/wechat/events')});});
action('wechatStop',async()=>show('wechatResult',await api('/api/wechat/stop','POST')));

