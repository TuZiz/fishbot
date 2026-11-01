## 2026-11-01 16:13：批量扩展改图指令识别（已部署）

按用户要求扩展一批表达，不只针对一条文案。引用照片下按明确请求语法识别任意人物/动物/物体的换色和替换、场景与背景转换、添加配饰、删除对象、修脸调光、裁剪旋转扩图、风格转换以及修改图中文字。支持礼貌请求前缀、句首/句尾@与微信特殊空格；保留提示词内邮箱和明确要写入图片的@文字。功能边界和例子见 `docs/image-intents.md`。

`tests/image-intent.test.ts`新增80种肯定表达、33种讨论/否定/教程/OCR等负例，以及@和无引用边界；`image-waiting.test.ts`将Mock闭环扩为生图与五种改图表达，验证先等待、引用编辑、回图和去重。完整105/105测试、TypeScript检查及构建通过，日志 `data/research/image-intent-batch-full-tests.log`；最初批量用例暴露两组缺口，已修复，失败日志单独保留。

云端仅更新dist/images/intent.js，通过原supervisor滚动重启，SHA校验、.env和settings保留检查通过。16:13健康、原生、自动下载就绪，真实发送/未暂停，唯一helper。两条此前未识别的真实引用输入，经只读重新分类均可识别；没有重新执行历史消息，也没有新增测试实发或付费API调用。证据 `data/research/native/image-intent-batch-deployment.json`、`image-intent-batch-verification.json`及routing-before/after文件。微信新用户指令的实际回图效果仍需用户自然发送新请求验收，不将Mock或重新分类冒充实发。

本次扩展的是改图文字指令，不是从图片提取文字的OCR；不做全量图片下载或任意模糊语言自动付费。保留原有群聊参与决策、去重/冷却/单任务、等待sent后加载引用图、核验失败不付费和unknown不重试。历史测试数量与记录保留。

## 2026-11-01 16:01：修复引用整图变换被误分到普通聊天（已部署）

截图问题定位为意图规则缺口：已解析到type3引用且真实@，但“把这个图片改成……”没有命中旧的背景/属性修改规则，走了普通聊天并发出文字。聊天模型提到无法读取原图不属于下载器错误，本条没有进入等待、引用加载或付费图片流程。

`src/images/intent.ts`新增引用照片下明确“把/将 + 图片/照片/图 + 改成/变成/换成/修改为”等整图变换规则；仍要求图片引用，普通讨论和转述不触发。补充指令及负例回归，完整Mock流程验证这种指令先等待再编辑回图且不调用普通聊天模型。97/97测试、TypeScript检查及构建通过，日志 `data/research/image-object-intent-tests.log`。

云端只替换dist/images/intent.js，由原supervisor滚动重启完成，.env和全部settings比较不变。16:01健康/原生/自动下载均就绪、未暂停、真实发送模式，仅一个helper。只读重新判定同一条截图入站已识别为编辑；这不是重新执行该请求，不冒充真人回图验收。本轮不重放旧消息、不发测试消息、不调用付费图片API，需用户发送一条新引用编辑指令验收。证据 `data/research/native/image-object-intent-deployment.json`、`image-object-intent-routing-after.json`、`image-object-intent-health.json`。此前96项测试和下载验证为上一轮证据，保留不改写。

## 2026-11-01 15:55：引用原图自动下载已部署（当前结论）

微信4.1.15.56当前精确DLL指纹已取得真实缺缓存证据：只读身份核验通过、请求前非缩略图候选0 → 程序原生kind3任务完成/resultCode=0 → 新快照候选1 → 微信解码MD5一致 → 有效JPEG，2,070,339字节。最终分文件生产下载模块独立加载、下载、解码及释放也通过。证据见 `data/research/native/quoted-download-evidence-summary.json`；单份探针中的保守字段不替代联结证据。

主8765已通过原supervisor滚动重启加载13文件增量，SHA校验及.env/全部settings（含人格）比较通过；connected/nativeReady/quotedDownloadsSupported均true、paused=false、dryRun=false。仅一个生产helper和一个supervisor，无8766监听、无残留下载研究进程。未改变现有后台文字/图片发送器和缓存解码器，保留全量无白名单、人格及图片限流。

触发范围仅为用户引用照片的改图指令：先确认等待提示sent，再读已有缓存；缺缓存时核验会话/原消息/作者/类型3/MD5后下载这一张。原图kind3优先，没有原图资源才考虑普通清晰图kind2，拒绝缩略图kind1。原生并发1、40秒任务期限，TS总等待45秒；取消/失败/unknown不重试，60秒同引用去重，暂停/上下文失效不进入付费调用。下载后重新快照查索引并核验MD5及图片格式。群引用fromusr为当前群时使用chatusr真实作者，不能把群ID当成人物；仍严格比对原消息作者。

本轮96/96测试、TypeScript检查与构建通过；完整日志 `data/research/quoted-download-final-tests.log`。新增等待回执不确定时不查图/不下载/不付费回归，原有单任务/去重/超时取消/身份错误等测试保留。本轮开发工具没有发送测试消息或调用付费图片API，不回放历史任务。新的生产“等待→未缓存下载→付费改图→回图”整体用户流程尚待一条新指令验收，不能将下载证据冒充整条付费闭环验收。真实下载中途取消、微信重启、长时间运行、其他DLL指纹尚未新增兼容性实测。

以下旧日期、旧“自动下载未实现/只支持已缓存”段落保留为历史，当前状态以本节及其真实证据为准。旧高层Hook隔离保持，禁止恢复旧RPC直接查询或重试已隔离入口。

## 2026-11-01：引用照片在正确任务上下文中查询、身份与MD5核验通过

新增研究工具 `native/research/probe-quoted-task-context.py` / `.js`。先提交不含消息的原生空操作，只拦截并匹配该操作复制的上下文与空向量；没有发送、下载或付费请求，也没有向原生队列传入 JS/NativeCallback。实测普通RPC线程当前协程为空，匹配任务内存在有所有权的协程、state=1。任务正常返回，临时Hook移除，自有操作/上下文释放。

随后通过相同任务上下文调用391a010，对已由只读快照核验的单张引用查询。实际得到消息，虚表、类型3、会话、发送者、server ID、local ID全部匹配；后续增加照片元数据类90a1f88及MD5比较，也与DB匹配。结果future及其消息包装在使用后按共享所有权释放。证据 `data/research/native/quoted-task-context-result.json`、`quoted-task-query-result.json`、`quoted-task-query-metadata.json`、`quoted-task-query-resources.json`。前三份为各阶段历史版本，最后一份对应最终MD5/资源验证版本。

这解决了“如何按引用ID取得真实消息模型”的证据缺口，**没有完成自动下载**。资源字段有值仅代表下载描述存在，不代表本地文件已缓存或下载成功。本样本 kind1/2描述存在、kind3描述为空。生产TS、配置、人格、发送器未改；最终8765只读健康检查ok/connected/nativeReady均true，backend=wechat-native-windowless。

下一步仅研究已核验引用图片的下载任务创建、启动、完成/取消和释放，并验证缺失缓存实际出现、MD5/解码有效后再接入唯一helper。无原图描述时必须明确区别普通图与缩略图，不猜枚举或将缩略图冒充原图。旧5个高层Hook及定向观察隔离不解除；RPC直接真人查询已在probe-quoted-query.py中于附加前硬拒绝，不能重试旧失败方式。

本轮实际验证：Python AST、嵌入JS/独立JS及Node准备脚本语法检查；真实任务上下文/引用查询/MD5与资源字段核对通过；RPC查询CLI隔离检查通过。本轮未改TS，未重跑历史90项测试，不将它们算作本轮证据。

## 2026-11-01：范围收窄为当前引用图，新增无Hook只读身份核对

用户明确只需要下载被引用的图片。后续触发必须位于引用照片改图请求内，先核验原会话、原消息ID、发送者、类型3和MD5；不做普通图片入站预下载、批量扫图或其他媒体下载。

新增scripts/prepare-quoted-image-probe.mjs：只选授权测试群最新一条照片引用，使用既有只读快照与quotedImageMd5核对，生成单张图片的身份比较输入，不输出聊天/密钥。新增native/research/probe-quoted-image-identity.py：精确DLL指纹、无Interceptor、无NativeFunction、12秒/512MiB扫描上限，只比较已核验引用身份，不输出内存指针或图片内容。云端实际准备通过；本轮扫描198815352字节、52个候选虚表、0个匹配引用对象、scanErrors=0。该结果只代表有界检查未发现对应对象，不证明全进程永久不存在，也不是下载验收。探针退出后主8765 connected/nativeReady仍为true；下载/发送/付费均0。报告data/research/quoted-image-identity-readonly.json。

离线沿实际虚表8f71468解析7个构造/复制/析构函数，又解析quoted-query、quoted-resource、quoted-loader、quoted-await工件。实际虚表槽+8为a888f0，经22ead90建立资源键；此前参考的22eafa0属于另一布局，不能套用。新布局中144/148/150各自语义必须分别核验，资源键复制150不能直接当作DB server_id。已定位391a010/39176f0按会话与svrid查询候选、17da070调用者、17dcd90结果等待和3991600/3993f70完成包装。返回值是带shared所有权的异步结果，并非消息裸指针；线程/等待/释放契约尚未运行验证，不直接从RPC调用候选或拼造消息模型。旧崩溃探针隔离保持。

自动引用原图下载尚未接通。当前缺口收敛为：无需打开聊天窗口，按已核验引用ID加载对应原消息，并以正确线程/所有权启动原图资源任务。生产TS与配置未改，不重放旧指令，不调用付费API。新增Node/Python/Frida JS语法检查和云端真实只读执行通过；未重跑未变更的TS测试。

## 2026-11-01：原图下载两轮被动观察有实际命中

## 2026-11-01 14:20：原图参数验证失败，探针已隔离，自动回复已恢复

备忘录群本轮手动加载触发了6条定向事件，但两个候选标识均无法匹配同群数据库消息，`identityVerified=false`；此前把对象字段称为消息ID的推断不成立。不得重放捕获对象或据此发起下载。

14:15:10（上海）云端微信发生访问异常退出（Application 1000，c0000005，模块unknown）；时间上与本轮Hook相邻，具体机理未确认，不能归因于用户操作。已停止观察，并在Python观察器硬拒绝这组高层RVA及image-target参数，PowerShell入口也拒绝定向观察；隔离版已部署云端。后续仅离线研究，不继续在生产客户端重复试探这些入口。

通过scripts/refresh-cloud-client.ps1验证相同4.1.15.56指纹，备份后仅刷新两份native profile的进程信息（9872→9340），保留参数、目标及登录状态。原8765服务自动重连；14:20只读复核ok=true、connected=true、nativeReady=true、backend=wechat-native-windowless、dryRun=false、paused=false。本次没有发送测试消息、调用付费API或重放任务，健康恢复不等于重新实发验收。

自动原图下载仍未实现；现有服务器已缓存原图→引用改图流程保留。下一证据缺口是真实消息包装对象/身份字段、资源枚举、线程与生命周期，离线解析完成前不接生产。失败核对见data/research/image-download-identity-failed.json。最后变更通过Python AST、Node语法、PowerShell解析；定向CLI实测在附加前拒绝。90项TS测试属于此前限流版本证据，本轮未重跑。


用户两次发送新普通图片并在服务器加载。第一轮120次采样完成，CDN入口3次、图片工厂1次；第二轮高层构造/恢复各3次，模块栈traceErrors=0，实际下载工作线程10988，读取策略另见UI1432。已解决SIMD复制日志造成漏xref，定位高层资源服务/消息共享对象/任务虚表。详见 docs/image-download-research.md。**尚未自动下载成功，生产配置未改。** 下一步定向核对类型3、测试群、消息ID及资源枚举，禁止直接重放捕获指针或参数。研究启动器SSH作业回收、ExitCode与路径拼接问题有记录和修正；不得误报为生产故障。

## 2026-11-01：未缓存原图自动下载正在验证

已扩展离线下载调用链研究与限时被动观察工具，详情见 docs/image-download-research.md。静态定位到 CdnManager/CdnCore/任务工厂及响应处理候选，尚缺从原消息建立下载任务的可验证高层入口。云端主8765保持运行，未改生产发送/图片配置，未启用自动下载，未执行付费图片请求。已准备新普通图片在服务器加载原图的被动实测；等待用户操作，不把观察器 ready 或静态函数视为下载成功。SSH 子进程回收问题已修正为保持会话至限时观察结束。

# FishBot 新会话交接

## 最新：图片重复触发保护已部署，待MCS重启

用户要求禁止短时间重复生图。新增ImageRateLimit，默认同会话/用户一项活动任务，付费调用间隔60秒，同会话同指令/原图5分钟去重；限流提示每用户/会话15秒至多一次。冷却/哈希/提示持久化，API失败和不明也保留冷却。重复图片入站走Store.accept(false)，不取消原pending、不增加session revision、不abort原API；合并阶段预留首条，全部退出路径释放。普通新聊天及手动暂停仍沿用原有取消行为。此规则取代下面“所有新图片指令取消旧图”的旧描述。

后台settings新增imageCooldownMs与imageDuplicateWindowMs，默认补全不重置persona。完整90/90、typecheck/build通过；云端5文件SHA/导入/内存限流冒烟通过，备份image-rate-before-1793511573。只部署settings/store/engine/images/conversation/rate-limit，.env、人格、图片解码、client、native、终端转发与统一runner保持。主服务未暂停重启、未另开helper、未付费/实发，需用户在MCS重启一次生效。重启后可只读核对配置和终端限流，不擅自用付费接口做重复压力测试。

## 最新：铁路群等待提示→自然引用改图→图片回传闭环已通过

复核临时副本清理未完成：对本轮已生成图片的本机/云端临时review副本执行精确路径删除时，exec_command自动审批以blocked by policy拒绝，未提供细化原因；未重试绕过，副本保留。没有删除data/generated中的正式结果，不影响服务。后续若处理这些副本须明确其为生成结果的复核拷贝，不能误删引用原图或正式生成产物。

用户服务器打开原图后发新指令，本轮最新输入2478779474649696448（真实成员@）先发送:image-wait，sent/attempts=1、回执3481724806359136632；约23.3秒后:image任务sent/attempts=1、回执668706472711166819。主8765正常，独立只读快照核对同群真实入站、等待正文/ID、输出图片文件MD5/ID，errors=[]、imageWorkflowPassed=true。证据data/research/native/group-image-wait-edit-confirmed.json。生成结果临时目视复核保留原人物主体、背景改为橙红火星风格，不再是无关空白参考图；用户远端效果确认尚未收到，不等同于用户满意度验收。该群窗口此时为下载图而打开，图片无窗口条件仍未验。

期间另有较早新指令3195741343285113052，只见其等待提示6877009984541382496，随后被最新消息替代，没有重发其图片任务；两个不同入站不是一次任务自动重试。原来的521758023167301660等缺缓存任务未重放。新消息到来时取消旧任务是现有行为，生成期间宜等待结果，不连续重发。

独立verify脚本新增 --incoming-id=... --image-workflow，匹配:image-wait与:image的原入站ID和原文件MD5（仅data/generated受控路径），本轮按主8765 --group-only --railway-test-group运行通过；只读检查不附加native、不调用图片API。仍需服务器原图缓存；自动原图下载尚未实现。上一节待新指令描述为历史。

## 最新：服务器打开原图后群引用缓存已就绪

用户回复已打开服务器原图，随后同一只读诊断确认铁路群原图9075485902109122846从cacheIndexRows=0/candidateCount=0变为1/1，文件实际存在；最新两条引用原消息/成员/MD5仍匹配。证据group-reference-cache-ready.json，与此前missing文件分别保留。未重放旧任务、未调用付费API、未附加helper。已请用户重新引用同图@发送一条新的“把这个图片背景改为火星”，待新指令后核对:image-wait的sent和最终:image回执；尚不能称本轮真人改图通过。

## 最新：群引用改图拒绝的只读定位（不是图片API失败）

用户截图显示新版已进入改图，但提示读不到原图。本聊天只读诊断实际群为测试群B（非备忘录）：最新入站521758023167301660、5208929406592690755都引用9075485902109122846。两条原消息/发送者/类型3/MD5均匹配，但hardlink索引对该MD5记录数0，原图候选0，未到native解码或付费API；不能用其他私聊图已成功的证据替代。更早4767591457523375463引用fromusr为群ID、发送者校验不匹配，另列历史问题，未放宽身份保护。脱敏证据data/research/native/group-reference-cache-missing.json、脚本scripts/diagnose-group-reference.mjs；只读快照/worker，没有第二helper。

已请用户在**服务器微信**铁路群中打开该原图并下载，尚待回复“服务器原图已加载”；此后先重跑同脚本确认candidateCount>0，再由用户发新编辑指令，不重放旧付费任务。原图自动下载当前未实现，当前证据是受支持索引无缓存，不保证任意缓存目录都没有文件。拒绝提示改为明确服务器端与缩略图限制，单文件dist/images/conversation.js已SHA/语法校验部署，下次自然重启加载文案；无需为此次只读排查立即停机。86/86测试、typecheck/build通过，新增缺原图不发等待且不付费回归。原图就绪实测仍pending，不能报告用户截图问题已全部解决。

## 最新：等待提示及截图自然改图指令已部署，待MCS重启

用户要求生图/美化先回复等待，又报告引用图说“背景换到火星上”“把这个图片背景改为火星”仅得到文字。已补type3/图片引用下的明确修改动作识别，并实现参数/原图/通道校验与去重后先发送独立:image-wait任务，确认sent才调用API，最后发图或单独失败文案。unknown等待不重发不付费；暂停和新入站取消仍生效。完整85/85、typecheck/build通过。云端4dist文件SHA及导入/意图冒烟通过，备份image-wait-before-1793510869；未改.env/persona/native/图片client或WXGF修复，未停止主服务。前一轮终端日志部署也保留。用户需在MCS重启一次加载所有更新，之后发一条新的真实引用改图验收；旧截图请求不重放。本轮无付费/实发，不称真人流程已验证。

## 最新：按用户要求新增终端收发日志，已部署待MCS重启

云端8文件日志增量SHA与导入冒烟通过；当前旧进程仍健康运行，未暂停、未重启、未另起helper。.env/最新persona/图片client、wxgf、cached-format哈希未变。用户需要MCS重启一次使launcher→supervisor→app加载新转发链路，此前面板只见启动信息是因为supervisor仅写文件。新TerminalActivity打印接收/AI/跳过/发送内容/最终结果，800字符截断和凭据遮蔽、图片不输出路径；允许用户明确要求的运行日志正文，仍禁止把真实正文输出到本AI工具或项目文档。正文隐藏开关TERMINAL_MESSAGE_CONTENT=false。81/81测试、typecheck/build通过；备份terminal-before-1793510648。下一步重启后看面板新消息活动，不重新部署旧图片或persona。详细实现与验证见DEVELOPMENT顶部。

## 2026-11-01 13:19 角色卡已改为无固定名字的腹黑风格

用户明确不再使用原“大肥鱼”感觉，允许腹黑且不要旧称呼。本轮新增src/config/persona.ts作为默认角色卡：无固定名字、冷静敏锐、轻度腹黑、反问/冷幽默、短句自然口语；保留认真求助时的实际帮助和事实边界，去除鱼类自称、贪吃懒散、装傻卖萌、套路化傲娇。明确历史人设不作为当前模板，未删除聊天记忆，未擅自指定新名字。

已通过既有鉴权PUT /api/settings热更新云端当前持久角色卡，并GET读回逐字校验；除persona外全部设置序列化比较保持一致，原MCS服务未重启。旧角色卡及4个部署文件备份在C:/wx/fishbot/data/deploy/persona-before-1793510332599。管理台页面称呼改为FishBot/机器人；默认settings和群参与提示中旧称呼同步从源码及部署文件去除。当前人格立即生效；已加载进程内的群决策器文字/默认模块在下一次自然启动加载新版，不为此额外停机。

验证：typecheck/build通过，4文件SHA验证与角色卡热更新读回通过；本轮仅提示词/页面文案调整，未新增或重跑业务测试，上一轮78/78是此前图像修复证据。未替用户发送聊天或修改微信账号昵称；实际聊天语气需后续自然对话观察。


## 2026-11-01 13:16 普通上传照片引用改图真人验收通过

用户在彩色层修复后引用同一原图片发送一条新编辑指令，并明确反馈“正常了”。随后只读核查主8765：新图片任务7为sent、attempts=1，入站5003365393925355601，发送回执1036171801463511767；用户效果/远端接收反馈与微信本地DB回执分开记录，合并支持本轮“普通相册上传图片 → 引用 → 编辑 → 原生图片回传”流程通过。历史任务6虽然sent，但效果失败，不能改写为成功；未重放历史付费请求。

最终78/78测试、typecheck/build通过。主服务MCS原实例运行，图片与文本统一helper、backup sunburst、7890代理、全量无白名单。普通图片原图读取已完成当前4.1.15.56版本和已实测WXGF单流/双流路径；早期“普通图片尚不支持”的段落仅为历史。故障原因、修复和备份见下面13:14记录。

剩余边界：原图须已在云端微信下载，只有缩略图则拒绝，不自动从CDN取图；47表情不纳入本次照片功能。WXGF只取彩色流的静态一帧，未实现完整透明动画合成；其他头/流布局拒绝。图片窗口关闭条件、实际微信重启和长时间稳定性仍未单独验收。未额外重复付费压力测试。


## 2026-11-01 13:15 彩色层修复后主服务已恢复

用户已在原MCS实例启动。只读健康确认主8765正常、wechat-native-windowless、imagesSupported=true、imageConfigured=true、imageProvider=backup、paused=false、dryRun=false、全量无白名单。已请用户引用同一原图片发送一条新背景编辑指令，等待主体保留效果反馈，不自动重发旧job。


## 2026-11-01 13:14 普通照片改图失真已定位，双层WXGF彩色流修复已部署

用户报告首次普通照片引用改图产物与原图无关，该轮不能算通过。只读复核最新任务确实为edit、有类型3引用、同会话原消息/发送者/MD5核对通过，sent、attempts=1；回执4360996096192850062。实际引用的是另一张用户图片，并非早先720×844的读取探针样本，不能用早先样本的MD5代替本次源图身份。

根因已通过真实缓存目视复核：本次WXGF含两个独立HEVC流，首流为透明度平面，旧的“整容器交FFmpeg取首帧”产生236×240空白PNG，API实际收到空白参考图，故生成无关画面。此前仅MD5/尺寸/PNG签名检查不足以保证转换内容正确。修复新增wxgf.ts，校验已实测19/20头与VPS/SPS/PPS/VCL结构，19头单流直接提取，20头双流提取第二彩色流；未知/不一致布局拒绝，不猜首帧。修正后本次真实缓存已还原正确彩色主体，PNG113786字节并目视确认。云端先前19头单流720×844样本再次转换876074字节通过，保留兼容。只选择一帧，不声称完整透明动图合成。

编辑API另加明确约束：保留主体、构图、文字，仅改用户指定部分。新增双层/单层/流数量异常回归，以及multipart精确上传参考字节和edits端点测试。最终78/78测试、typecheck/build通过，相关8/8先行通过。未重放失败job、未执行新的付费调用。临时本地/云端图像目视副本均已删除；保留脱敏诊断photo-edit-diagnosis.json和原始正常生成产物。

主服务维护pause→空闲检查→shutdown→0监听/0helper确认后，仅更新dist/images/cached-format.js、wxgf.js、client.js三个文件；SHA清单通过，备份C:/wx/fishbot/data/deploy/backup-photo-colour-1793510058207。自有STOP已清除，等待用户在原MCS实例启动；未改.env、windowless发送器及生产依赖。部署脚本scripts/apply-photo-colour-fix.mjs。旧cached-photo-release stage的三个images文件已更新，旧manifest不再对应当前stage，不能直接用旧manifest重放整个stage。正在等待原实例恢复和用户单次新引用改图实测；不能标记最终效果通过。


## 2026-11-01 13:07 普通相册照片读取已部署，等待引用改图真人复验

普通相册照片的 V2 DAT 读取已打通。根因是此前 aa7d10 探针错误地把 UTF-8 std::string 输入构造成了 std::wstring；反编译的 SSO 阈值15及调用转换链确认后修正。云端 RPC 线程解出既有合成 PNG 7873字节、MD5匹配，无新增UI Hook、无图片密钥导出。用户第一次测试实际为47表情，不能算普通照片；第二次从相册发来的类型3照片已只读定位并解出34467字节WXGF、MD5匹配。

新生产链路：精确同会话/原消息64位ID/发送者/类型3核对 → hardlink索引选择非缩略图（HD优先）→ canonical路径限制在当前账号msg/attach → 既有native helper内RPC调用微信自身解码器 → 原始解码字节MD5二次确认 → PNG/JPEG/WebP直接使用，WXGF由本地FFmpeg7.1转为首帧PNG（最长边2048）→ 付费改图。数据库快照运行在独立worker并清理；原图及转换图不额外落盘。两并发读取上限、30秒查询期限、15秒转换期限、20MiB大小上限，暂停/新消息取消后不调用付费API。已生成机器人图片仍优先沿用原图引用。

真实照片在生产完整IPC/快照/索引/解码/转换链路冒烟通过：输出720×844 PNG、876074字节、paidRequests=0、sends=0。云端证据 `data/research/images/received-photo-conversion.json` 与 `received-photo-ipc.json`。测试程序已退出，确认0监听、0 native helper后清除自有image-maintenance STOP；随后用户在原MCS实例启动，主8765健康、windowless、imagesSupported=true、paused=false、dryRun=false、全量无白名单、备用生图及7890代理保留。正在等待用户引用刚才普通照片实际改图；不能把该冒烟说成已完成真人API改图/远端送达。

验证：76/76测试、typecheck、build通过；JS及Python语法检查通过（后续研究脚本小改经实际执行验证）。部署12个精确manifest文件，SHA逐项校验，未覆盖windowless-agent.js、未改.env/依赖。备份 `C:/wx/fishbot/data/deploy/backup-cache-1793509073152`；FFmpeg从锁定imageio-ffmpeg0.6.0 wheel提取到独立 `C:/wx/tools/imageio-ffmpeg-0.6.0/`，二进制SHA与本地一致、许可证随附，未加入npm生产包。部署脚本 `scripts/apply-cache-release.mjs`；云端stage在data/deploy/cached-photo-release。

限制：需微信已下载非缩略图缓存，未新增自动CDN下载；47表情、未下载原图、未知格式明确拒绝，WXGF按静态照片取首帧。当前精确支持云端4.1.15.56既有DLL指纹，其他版本拒绝。图片关闭窗口条件、微信真实重启恢复与长时间稳定性未单独验收。更早“普通V2原图尚未解决”的历史已被本节读取实测取代，但完整普通照片改图仍等待用户结果。


## 最新确认：备忘录群关闭窗口自动回复验收通过

用户随后明确确认：本轮服务器“备忘录”群窗口已关闭，微信停在其他会话。结合下节同一轮独立DB证据（入站3498811319557008535、真实@、一次发送、回复5391333757526935367），群无窗口文字自动回复验收通过。窗口条件来源为用户确认，收发内容/ID来源为独立只读快照，两种证据分开记录于main-memo-group-acceptance.json；此前“窗口条件待确认”已被本条取代。主8765保持运行、全量无白名单。无需再次要求用户开群窗口或重发铁路测试；铁路群关闭窗口未单独验收，不能扩大到所有群逐一实测。好友及filehelper先前无窗口文字回执仍有效。图片关闭窗口、实际微信重启恢复、长时间稳定性与普通V2 DAT原图提取仍有独立未验收项。

## 最新：主实例备忘录群真实@闭环通过（关闭窗口条件待确认）

用户本轮实际在“备忘录”群@，因此直接核对该群而非要求重发铁路群。主8765 windowless backend、requiresChatWindow=false、imagesSupported=true、dryRun=false、paused=false；新入站3498811319557008535确认真实他人发出且mentionedBot=true，队列sent、attempts=1，回复5391333757526935367。独立只读DB快照核对入站、同群回复正文和ID匹配，errors=[]，证据 `data/research/native/main-memo-group-acceptance.json`。用户尚未明确这次备忘录群窗口是否关闭，故报告windowsClosedByUser=false、远端设备送达未独立确认；已追问窗口条件，不将backend能力声明替代该条件验收。

本轮仅同步独立verifier脚本，新增 --main-runtime、--group-only；窗口关闭声明改为必须显式 --windows-closed-confirmed，不再硬编码true。未重启主服务、未启动第二helper、未改.env或图文发送器。主健康保留快照源变化历史计数4，当前inboxError=null；不声称零故障长稳通过。

## 2026-11-01 12:39 真人私聊生图与引用改图验收通过

用户完成新一轮两步测试并确认两步均正常。随后只读核对云端主 8765：两个真实图片任务均为 sent、attempts=1，属于同一会话；新生成图片回执 `1980677300078496706`，引用该新图编辑后的图片回执 `5302605910866322933`。队列记录是微信本地数据库确认，用户反馈补充了远端实际收到和流程可用的证据；未把此前失败请求重放。脱敏现场记录在云端 `data/research/images/live-image-status.json`。

当前主服务健康，windowless backend、图片能力开启、备用 sunburst 生图、7890 代理生效，paused=false、dryRun=false、全量会话开启。最终完整测试 72/72 通过；本次验收只更新文档，不改运行代码、不重启主服务。后台群补验继续由另一聊天使用现有主实例执行。

仍未完成普通收到照片的 V2 DAT 原图提取；当前引用编辑支持同会话、已确认发送并留存原图的机器人生成图片。图片发送在目标聊天窗口关闭条件下未单独实测，不把 windowless 路径名称当成该条件已验收。旧日期段落仅保留研究历史，以本节最新状态为准。


## 2026-11-01 图文通道已部署、代理修复后等待真实聊天复验

已由用户从 MCS 原实例恢复统一主服务 8765。最新健康：`wechat-native-windowless`、`requiresChatWindow=false`、helper `imagesSupported=true`、`imageConfigured=true`、`imageProvider=backup`、`paused=false`、`dryRun=false`、全量会话开启、白名单为空。只有一个 native helper；不再启动 8766 重复附加。后台群验收聊天可在主 8765 继续铁路群验收，不覆盖图文分支或环境变量。

原生图片证据：完整文件工厂到 controller 的新合成 PNG 独立回执 `7545803196978937195`；统一全局 operation 路径另一张新合成 PNG 同 MD5 回执 `2263122352628582260`。实际 API 生成 PNG 已被微信发送，独立回执 `3907179981453285085`，但旧游标处理漏掉初始空 body 的上传行，队列记录 unknown，未重发。修复后，新的约 3MB 随机像素 PNG 在持久队列派发测试中 sent、attempts=1，回执 `7558458561138677880`，独立快照同 MD5 再次通过。该派发测试的入站是合成的，不能说已通过真人聊天全流程。证据在 `data/research/images/windowless-image-confirmed.json`、`unified-image-delivery.json`、`large-image-confirmed.json`。

本次修复图片上传生命周期：先对自己发出的 server_id=0 行保留 pending，再解析正文；server_id 已补但图片 MD5 尚未齐全也继续重读，不越过后续回执。新增回归测试通过；修复后全量 71/71 测试通过。随后追加图片网络错误脱敏分类，相关 6/6 测试、typecheck/build 通过；最终完整复验计数后续补记。

首次真人私聊生图返回失败，原因已确认是云端直连两个图片站点均 `UND_ERR_CONNECT_TIMEOUT`，不是原生发送失败。用户确认服务器已有 `127.0.0.1:7890` 代理；通过它两个 `/models` 都 HTTP 200，新独立云端生图约 17.693 秒成功。已在云端 `.env` 配置 HTTPS_PROXY、NODE_USE_ENV_PROXY=1，并保留原 NO_PROXY 项、增加 localhost/127.0.0.1/api.deepseek.com，Windows 系统代理未修改、DeepSeek与本机接口直连。主站本地两次 flare 推理等待 180 秒超时，因此新图片请求暂选已实测的备用 sunburst；主站配置和密钥保留。用户原失败消息不自动补发、不重复计费调用，正在要求新的真实消息验证。

Node 22.23.4 已实测支持 --use-env-proxy。**代理必须在 Node 初始化之前加载**：MCS start-server 先加载 `.env`，子 supervisor/app 继承变量；SSH 独立脚本用 `node --env-file=.env --use-env-proxy <script>`。只在脚本里 dotenv 加载可能过晚。代理启用出现 Node 的 UNDICI-EHPA experimental warning，功能探针已通过；不要把该提示当成 API 失败。

部署：原文件及 `.env` 备份在云端 `data/deploy/backup-images-1793506065244/`；含密钥，不能打印、外传或打入普通发布包。云端 npm ci 因 npm 仓库超时失败（Exit handler never called），已改为本机锁文件对应的 58 个纯 JS 生产依赖离线同步，3078 文件逐 SHA256 校验通过、四个关键模块导入通过。额外回执/网络诊断修复已同步至 dist；原生 helper/统一 JS 与 Python host 保留后台聊天的 railway profile 许可。STOP 由图片任务校验拥有者后清除，MCS 完成启动，没有留下额外测试 helper。代理更新前再次维护停机也已收尾，原图预览测试临时隐藏的两个合成源文件已恢复。

**尚未完成**：普通收到照片的 V2 DAT 原图提取。硬链接索引已只读定位，native aa7d10 在 RPC 和 UI 线程均返回 -1/空字节；只针对合成图的预览观察未获得可用解码结果，未提取登录凭据或图片密钥。当前引用编辑仅支持同会话、已确认发送并保存在 data/generated 的机器人生成原图；不支持任意上传照片，不假装识图。窗口关闭条件下的图片真实验收未单独完成（调用路径不使用聊天控制器）。


最新补充：用户确认上一轮群消息发在“测试群B”；当时隔离监听仅“备忘录”，故没有该群验收记录。已在本地为测试 runner 和独立 verifier 增加 `--railway-test-group`（runner 同时需 `--live-friend-test --include-test-group --windowless`），Python host 接受独立 cloud-railway-profile。尚未部署/启动，图片聊天仍独占环境。只读复查8765/8766无监听、STOP存在、微信进程存在；不要让用户此时再次发送验收消息。下一步待图片任务交还环境后，关闭测试群B窗口，使用一致范围核对新入站、AI、单次发送及独立DB回执。

当前文件/运行环境协调：后台发送聊天已停止编辑`native/windowless-agent.js`并继续不启动8765/8766/native探针，图片任务正在独占研究并准备可选图片分支。不要以旧副本覆盖该JS，不删除图片任务STOP；接续前先读`docs/COORDINATION.md`。图片任务报告完整工厂PNG单条送达ID7545803196978937195，本聊天未独立复核；这不等于windowless图片或整条图片AI流程通过。

## 2026-11-01 后台发送验收与独占环境交还

已按图片任务的维护协调收尾8766：先/control暂停，核对无pending/sending，按监听端口、完整路径、命令行、父PID核对后停止本轮测试Node11932与其Python helper21236；旧runner无shutdown HTTP端点，本次为空闲进程核验后停止，不称优雅IPC退出。STOP保留，8765仍无监听，微信未退出。后台发送聊天不再新开helper，等待图片任务独占实发结束；不替图片任务关闭已打开的filehelper窗口。协调事实见`docs/COORDINATION.md`。

用户确认关闭对应窗口后，后台私聊已真实通过：入站491229873540567784为其他好友来信，队列sent、attempts=1，回复4649998093315991004，独立只读快照正文/ID匹配，errors=[]。群验收尚未通过：同一独立快照没有备忘录群本轮新入站，已询问用户实际发在测试群B还是备忘录；等待回答，不重发。`verify-windowless-runtime.mjs`整体passed=false是缺少群记录，不能覆盖私聊成功或解释为后台发送器失败。证据`data/research/native/windowless-private-acceptance.json`。

此前filehelper无窗口单条确认ID4884557870524647667。当前生产.env未开启FISHBOT_WINDOWLESS，后台发送尚未统一部署到MCS；图片通道也尚未与此windowless文字实现合并验证。不能宣称无人值守完整上线。

## 2026-11-01 11:38 并发开发与云端维护状态（图片任务）

图片聊天与原项目后台发送聊天正在共享工作区和云端微信。图片任务已通过 `/control` 暂停并在队列空闲后设置 `C:/wx/fishbot/data/STOP`（内容 `image-maintenance`），随后优雅关闭 8765，因此本轮 8765 停机有明确的维护原因；该标记由图片任务创建。原项目聊天随后启动了独立的 8766 windowless 验收，且用户按该聊天要求关闭了 filehelper，图片任务已经停止新的原生探针，避免双 Hook。尚未协调两者的恢复/部署顺序，不能直接删 STOP、启动第二 helper 或覆盖另一聊天的新版本。

图片进展：4.1.15.56 图片草稿工厂 `3e22d70` 的三次不同合成图片提交均无图片 DB 回执，结果不明，不重放。文本控制探针有独立新 DB 回执 `6585390509419298883`。离线发现并用仅构造探针确认真正文件工厂 `5ddc8c0`：返回 56 字节结构（首 16 字节 shared_ptr，其余是标量），对象 vtable `92b2a88`、类型 3、UTF-16 原路径位于 +120、文件大小 +1c8。完整文件工厂尚未执行真实发送，不能启用生产发图。旧草稿对象 +120 是临时目标，+168 是原路径，缺少文件准备导致此前图片未发出；不再使用草稿工厂作为完整发送路线。

新增代码仍在本地开发：类型3图片/49引用解析、同会话已确认机器人生成图片的原图引用、send-image IPC 与 MD5/新消息ID回执校验。普通收图的 V2 DAT 已确认存在（头 `070856320807`），其原图解密尚未实现，未提取新的登录凭据或图片密钥。原生能力默认仍关闭；windowless-agent 尚不支持图片，两种能力不可混报。具体本轮代码和最终验证待后续记录。


## 2026-11-01 微信图片本轮实现与验证（尚未完成云端启用）

已实现类型 3 图片元数据及类型 49/57 引用解析（新增 fast-xml-parser 5.11.2），保留大整数消息 ID，丢弃 XML 中的 aeskey/CDN 地址等字段，拒绝 DTD/ENTITY 和超限 XML。图片自发 server_id 后补沿用游标恢复；普通图片不会交给纯文字模型假装识图。引用编辑现可从同会话 outbox 中以已确认的发送消息 ID 找回机器人生成原图，且限制在真实路径位于 data/generated 内的文件，跨会话和外部路径拒绝。用户上传的任意 V2 DAT 原图解密尚未实现，不能称通用引用图片提取已经完成。

原生接入增加 send-image IPC、文件大小和 MD5 二次确认、同目标/同 MD5/自己发出/新数字消息 ID 的图片回执校验。图片等待回执最多 45 秒，Delivery 总超时 60 秒；unknown 不重发。已抽出共用串行派发和回执生命周期，重连与文本发送不并发。只有 WECHAT_NATIVE_IMAGES=true 且 helper 启动握手明确 imagesSupported=true 才声明图片能力；默认保持 false，windowless backend 当前明确拒绝图片。配置只改变已实现能力的启停，不能替代版本验证。

4.1.15.56 真正图片文件工厂 0x5ddc8c0 已通过仅构造运行探针，布局、UTF-16 原路径、文件大小和释放路径符合静态源码证据；完整工厂尚未实发。三次不同旧草稿工厂实验无图片 DB 回执，均记 unknown，不自动重放；文本对照有独立 DB 新回执。云端修改目前仅包括隔离探针脚本和合成素材，未开启生产图片功能、未同步生图密钥。8765 的图片维护停止与另一聊天 8766 的后台发送验收并行，状态见 AI_HANDOFF 顶部维护记录；等待用户允许跨聊天协调，防止重复 Hook/部署互相覆盖。

验证：相关媒体/原生测试通过后，全量 70/70 测试通过；最后抽出共用原图文件读取边界（owned-file.ts）后，19/19 相关测试、typecheck、build 通过；memo-agent JS 语法、Python host 编译通过。日志 data/images-wechat-tests.log。已有 SQLite experimental warning 不变。新修复过一次测试调用签名不匹配（sendImage 原空参数测试改为传目标和文件），最终类型检查通过。未执行完整微信收图→改图→回传，原因是 V2 DAT 尚未解密、完整图片工厂尚缺实发回执、并发验收待协调。

## 2026-11-01 聊天生图下一步：备用生图、改图 API 已实测（本地，未部署）

`api.zyuou.com` 的 `gpt-image-2.5-sunburst` 已完成两次独立合成测试：generations 返回 HTTP 200 和 PNG，用时约 15.4 秒；edits 接收 multipart 参考图，约 27.8 秒返回 PNG，蓝色杯子变为绿色，已目视核对杯形、背景和颜色。证据位于本机忽略目录 `data/research/images/backup-probe.json`、`probe-backup-edit.json`，对应图片 `backup-probe.png` 和 `e15f3f24-fde4-4c6b-95ba-697b573d12e4.png`。这些不是微信送达证据。主站上一轮 flare 请求 180 秒超时，原因未确定，没有自动重发或切换备用重复同一请求。仍保留用户指定的主备顺序。

实现：`src/images/client.ts` 支持 base64 与受控 HTTPS 图片 URL，先落盘再排队；`artifact.ts` 限制响应和文件大小、校验 PNG/JPEG/WebP 签名，每次重定向重新检查允许的 origin，下载不携带 API 密钥。`IMAGE_DOWNLOAD_ORIGINS` 为逗号分隔的已核实 CDN HTTPS origin（无路径和末尾斜杠），默认只允许当前服务商 origin。`IMAGE_TIMEOUT_MS` 默认 180000，可设 1000..600000，覆盖整次请求和下载；超时仍不自动重试。付费去重与迟到图片清理由 `src/images/conversation.ts` 负责；图片配置边界在 `src/config/image-environment.ts`。超时失败提示不再被请求开始时刻的旧 TTL 吞掉。

复现实测（会调用付费 API，每次都是独立合成测试，不用于重发不明结果）：先 `npm run build`，再运行 `node scripts/probe-image-api.mjs --backup`；参考图编辑用 `node scripts/probe-image-api.mjs --backup --reference data/research/images/backup-probe.png`。脚本只输出脱敏状态、耗时和产物文件名，证据写到 `data/research/images/`，不输出密钥、提示词或图片字节。

聊天触发示例：`生图 一只海边的猫`、`画一张星空`、`美化引用的图片`。群聊仍先判断参与，DRY_RUN 不调用付费 API。当前原生 NativeMemoAdapter 尚未实现图片发送，微信接收仍只解析文字，未提取引用图片，所以聊天生图和美化引用图片仍会明确拒绝。客户端 edits 已成功，不等于微信引用图片链路完成。当前只有 Mock 声明支持生成图片发送；未新增兼容猜测、未修改 Hook、未部署云端。生成文件暂未自动清理。

验证：全量 66/66 测试通过；随后职责拆分和超时反馈调整后的相关 10/10 测试、typecheck、build 通过。既有 SQLite experimental warning 不变。主站根因、微信图片提取、原生发图与远端送达仍 pending。公开网页发现的 batches 接口面向 Gemini，未据此更换 GPT 路由。




更新：2026-11-01。此文档是状态与接续索引，执行规则见项目根目录 AGENTS.md。后续 AI 应先确认实时状态，不能把这里记录的 PID、端口健康或测试结果当成当前仍成立。

## 当前最重要的任务

用户要求解决：**服务器未打开对应聊天窗口，也能收到消息并自动回发**。

这项尚未完成。用户刚要求先生成项目 Agent/交接文档，本轮优先整理文档；后续应接着做后台发送研究，不要从 Mock 或白名单问题重新开始。

接收和 AI 不依赖打开对应聊天窗口。当前原生发送依赖有效聊天控制器：会话关闭/切换后可能失效，不能对任意后台会话保证回发。取消白名单并没有解决这个限制。

## 项目位置与技术栈

| 项目 | 位置/值 |
| --- | --- |
| 本地工作区外层 | `<workspace>` |
| 实际项目根 | `<workspace>\fishbot` |
| 云端项目根 | `C:\wx\fishbot` |
| SSH | `ssh -p 2022 <ssh-user>@<deployment-host>` |
| 已恢复的部署私钥 | 本机 `%USERPROFILE%\.ssh\id_ed25519_fishbot_deploy`，只传路径，不读取/展示内容 |
| 云端 Node | `C:\wx\tools\node\node.exe`，22.23.4 |
| 本地 Node | `<workspace>\.tools\node-v22.23.4-win-x64\node.exe` |
| 本地 Python | `<local-user-profile>\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe` |
| 云端 Python | `C:\Users\Administrator\AppData\Local\Programs\Python\Python313\python.exe` |

TypeScript ESM、Node >=22.13、Fastify 5、Zod 4、SQLite `node:sqlite`、DeepSeek HTTP。Pino 由 Fastify 日志使用。Frida/pefile/Capstone 属于隔离研究依赖，不在生产 npm dependencies 内。`legacy/` 不参与当前编译。

本地外层曾执行 git status 显示不是 Git 仓库；不要假设存在可用 Git 历史或可重置工作区。先检查再操作。

## 已经实现并验证的范围

- Mock 私聊、多人群聊完整链路；DeepSeek 真实 API、人格、上下文合并、两阶段群聊决策、冷却、话题过期/迟到取消、用量统计。
- 记忆与摘要、按会话隔离、来源标注、删除/清理；表情素材目录和缺图降级。真实大肥鱼素材未完整提供，原生图片发送未验证。
- SQLite WAL/迁移/去重/持久发送队列；DB 自发消息 server_id 后补重读；helper 故障保护、unknown 不重发。
- Web 管理、鉴权、健康、暂停、日志和 Windows 启动/守护。
- 云端 WeChat 4.1.15.56：文件传输助手、测试好友普通私聊、测试群真实成员 @、新群“测试群B”真实回发均已获得 DB 发送回执。只有部分轮次有独立观察器复核，见证据表。
- 本机 4.2.0.12 先前也完成授权好友/群文本回发，但不能用它的结果替代云端版本验证。

群聊无需 @ 的自然参与逻辑存在；没有单独完成云端真人自然接话验收。不回复某条普通群消息不一定是故障，应查参与决策、冷却和队列。

## 当前云端默认启动方式

用户明确要求默认不需要好友/群白名单，已经配置并经 MCS 面板重启核对：

```text
MCS -> C:\wx\tools\node\node.exe C:\wx\fishbot\scripts\start-server.mjs
    -> scripts/supervisor.mjs
    -> scripts/run-cloud-all.mjs
```

非敏感配置：

```dotenv
FISHBOT_CLOUD_ALL=true
CLOUD_NATIVE_PORT=8765
NATIVE_DB_PATH=./data/fishbot-native.sqlite
DRY_RUN=false
```

运行时 settings：`allConversations=true`、`whitelist=[]`、私聊/群聊开启。最后加载76个会话；**76个接收目标不等于76个原生发送目标就绪**。最后仅1个原生目标就绪。健康接口标签仍复用 `native-memo-experimental` / `testOnly`，不代表还在仅限旧测试对象的入口。

主管理台为服务器本机 `http://127.0.0.1:8765/`。鉴权接口用 `.env` 的 `INGEST_TOKEN` 放入 `x-fishbot-token`，不要回显。独立8766试验已优雅关闭，后续不要默认再启动重复 native helper。

`.env` 保留原有密钥；切换前备份位于云端 `.env.before-native-all-20261101105428`。不要将其内容纳入文档或打包。

当前云端版本特有限制：

- `run-cloud-all.mjs` 启动时读取真实目录并生成 native profile；新会话需重启 FishBot 加载，尚未动态刷新。
- 当前 profile 固定微信 PID、观察到的线程；客户端退出/重启后不能保证恢复，不能跨 PID 盲用地址。
- 入口目前启动时强制全量开关、清空白名单、解除全局暂停、关闭表情；不是完整的配置保留/迁移方案。注意不要将此实验性质写成成熟部署。
- 默认 `npm start` 仍是原核心入口。生产全量选择由 supervisor 的 `FISHBOT_CLOUD_ALL` 分支完成。
- `run-cloud-all.mjs` 以外部 Adapter 注入，内部环境 ADAPTER 设为 mock；这并不使用 Mock 发送。部分 `/api/wechat/*` 路由没有连接该外部观察器，不能用其空结果否定主 Adapter 正常工作。

## 代码导航

| 职责 | 文件 |
| --- | --- |
| 装配、HTTP、设置同步、发送许可 | `src/core/application.ts` |
| 队列派发、超时、不明结果 | `src/core/delivery.ts`、`src/storage/store.ts` |
| 会话合并、取消旧回复、AI生成 | `src/conversation/engine.ts` |
| 群参与判断、冷却/频率 | `src/group/participation.ts` |
| AI、记忆、素材 | `src/ai/`、`src/memory/`、`src/expressions/` |
| DB 接收/恢复 | `src/adapters/wechat/database/{observer,worker,messages,snapshot,crypto}.ts` |
| 原生 IPC/恢复/回执 | `src/adapters/wechat/native/{bridge,recovering-bridge,memo-adapter}.ts` |
| 对象发现、生命期、实际调用 | `native/context-registry.js`、`native/memo-agent.js` |
| 当前云端 helper | `native/research/probe-cloud-native.py` |
| 全量入口 | `scripts/run-cloud-all.mjs` |
| 旧限定实验入口 | `scripts/run-cloud-filehelper.mjs`、`scripts/run-native-memo.mjs`，不要当默认全量入口 |
| 离线分析 | `scripts/research-wechat-native.py`、`native/research/ghidra/FishBotOffline.java` |

`NativeMemoAdapter` 的 catalogMode 已支持按 ID/类型验证同名会话、全部目录目标非self入站，并禁用自己的“鱼测试：”转交。`application.ts` 在 allConversations 下把 Adapter 接收的新会话同步到 Delivery 许可集合，避免空白名单导致已生成回复无法发送。

## 发送实现和版本研究入口

云端 DLL：`C:\Program Files\Tencent\Weixin\4.1.15.56\Weixin.dll`。

```text
SHA-256: E0428A7B691853DE496532523C2C09AA095F90941C37C9F4CFB3F137F3C66556
最后观测微信根PID: 9872
最后观测提交线程: 1432
```

这些是历史观测，操作前重识别；特别是 PID/线程不可当永久配置。helper 现有硬编码是待修复限制。

本地隔离研究目录：

- DLL/映射镜像/反编译：`<workspace>\.tools\research-weixin-4.1.15.56\`
- Python 库：`<workspace>\.tools\hook-research\`
- Ghidra：`<workspace>\.tools\ghidra_12.2_PUBLIC\`
- Java：`<workspace>\.tools\jdk-25.0.5+8\bin\`
- Ghidra classpath/已编译分析类：`fishbot/data/research/native/ghidra-classpath.txt` 和 `FishBotOffline.class`。

云端隔离目录：`C:\wx\tools\fishbot-frida-research-17.25.0\`，包含 Frida 17.25.0、`probe-cloud-native.py`、两个 JS 源文件及 `cloud-profile.json` / `cloud-all-profile.json`。它们有些由研究过程生成，**仅拷贝 dist 不能构成完整的新服务器部署**。当前 Python host 会对基础 JS 做精确版本偏移替换；长远应独立成清晰版本 Profile，不能擅自去掉校验。

已实测路径：文本工厂 → QList → controller submit，执行后按同目标/同正文/新消息ID确认。控制器通过 QObject 自指针、精确虚表、存活发送服务和会话ID绑定验证。目标在 `controller+0x10` 会话对象的 `+0x260`，直接读 controller+176 是早期错误诊断，已纠正。

## 后台发送研究刚进行到哪里

最新实测：用户确认服务器filehelper窗口关闭后，`probe-empty-operation.py --execute-windowless-filehelper-test`已通过全局延迟操作发送一条合成消息，未使用聊天控制器、执行线程17384（不是旧UI线程1432）。标记`FishBot_Windowless_1793503788`，独立只读快照确认新消息ID `4884557870524647667`、errors=[]。这仅证明filehelper单条后台文本，不等于好友/群已通过。

新增`native/windowless-agent.js`：9处指令指纹校验，新消息的收件人初始化（短ID使用SSO，长ID用同版本native CRT分配），UTF-8正文校验、std::vector<shared_ptr>延迟操作、独立空回调上下文和全局调度执行，按所有权释放。没有修改任何现有控制器或已发送消息。新Python helper `--windowless`启用该模块；`FISHBOT_WINDOWLESS=true`使全量runner选择该路径，默认尚未切换生产。状态新增requiresChatWindow，后端显示wechat-native-windowless，结果仍须DB回执确认，unknown不重发。

当前8766隔离入口正在运行`run-cloud-filehelper.mjs --live-friend-test --include-test-group --windowless`，只允许既有授权好友和备忘录群，等待用户关闭两者聊天窗口后发来验收消息。健康connected=true、requiresChatWindow=false。此前8765主服务此时已不存在，无法暂停；检查只有本轮测试Node11932在运行，没有判断其退出原因。验收结束必须恢复MCS默认主服务，不能留下只有SSH实验进程的部署。

当前工作区同时出现图片模块等其他更改，本轮已保留。首次全测66项中1个图片提示断言失败，原始日志`data/windowless-tests.log`；后续对应文件已变化，复验69/69通过、typecheck和build通过，日志`data/windowless-tests-recheck.log`。不要把本轮说成修复了其他图片模块，也不要覆盖这些并行改动。独立验收工具`scripts/verify-windowless-runtime.mjs`准备在两条真实测试回复后核对输入身份/@/输出正文与新消息ID。

接续研究的新进展：`19e5db0`已确认是操作克隆函数，**不是析构**；虚表`0x92ea088+0x20`对应释放函数`1949550`。上下文构造`f910`、复制`5f2b0`已反编译。`native/research/probe-empty-operation.py`在云端通过原生空操作创建/克隆/释放2个对象，以及空回调上下文创建、复制、强引用增加和释放测试；没有订阅、没有发送。这说明操作和上下文的基础所有权可以独立于窗口建立，但尚不证明可发消息。

该探针新增显式`--execute-windowless-filehelper-test`选项，仅允许一条固定格式合成标记到filehelper，通过新建消息初始化收件人，不修改任何现有控制器或已发送消息。默认不发送。单次发送逻辑和`scripts/confirm-windowless-filehelper.mjs`独立只读回执核对工具已准备，Python/JS语法已检查；**尚未运行主动发送选项**，正在等待用户确认服务器filehelper会话关闭后执行。不得把准备完成冒充实发通过。依赖指纹文件位于本地`.tools/research-weixin-4.1.15.56/empty-operation-fingerprints.json`和云端研究目录。

本轮结果补充：第二轮120秒观察确认`3de9600 -> 3e1cb60 -> 1969b50 -> 19b9d10`各命中1次，`19ba020`未命中。第三轮针对合成filehelper消息做精确布局匹配：线程1432，std::vector内1个shared_ptr消息；消息虚表RVA `0x9026b48`、全局服务虚表`0x92e51d8`、延迟操作虚表`0x92ea088`。没有保留或再次使用观察到的消息对象、没有主动调用新服务。记录`data/research/native/background-service-research.json`。

已反编译延迟操作析构`19e5db0`及执行方法`19e5f00`，后者取得全局调度服务，复制消息向量及执行上下文，再通过`30f450`调度含消息向量的任务（任务虚表RVA `0x92ea168`）；它需要有效执行上下文，不能给第二参数随便传null。仍需验证`19e5060`订阅入口、上下文构造/销毁、全局服务取得的共享所有权，以及新消息的收件人初始化。不能复用已发送消息对象或对现有控制器改收件人。无窗口真实发送尚未完成。本轮没有改生产发送路线。

2026-11-01后续更新：已沿任务虚表继续反编译 `3de62d0`、`3de76d0`、`3de7800`、`3de8e20`、`3dea550`、`3de8d90`、`3e59c60`、`3dea2e0`、`3e253d0`、`3de9600`、`3e1cb60`、`1969b50`、`19b9d10`、`19ba020`，均位于同一decompiled目录。直接调用者扫描确认controller构造器`3de3a20`唯一调用者`1c06c50`（模型构造），其唯一调用者`1c3f3e0`又包含大量界面装配，不能直接当作无窗口工厂调用。

真实手动合成发送的第一轮120秒被动观察：自检1次，`3de62d0`命中1次（返回点`3de5ee9`）、任务执行函数`3de7800`命中1次（返回点`3de66cc`），但`3de8e20`、`3dea550`、`3e59c60`均0命中；说明不能把最先选出的更下层候选直接当本次文本发送路径。未读正文、未主动发送。`observe-cloud-input.py`新增background-candidate类别和可选`--output`证据输出。

新的静态线索：`3de7800 -> 3de9600 -> 3e1cb60`，后者从全局服务注册器获取接口（标识常量VA `0x189022c98`），调用`1969b50`准备消息，`19b9d10/19ba020`构造包含共享消息向量的延迟操作，`19e5060`参与后续执行/回调。还没有验证全局服务 ABI、收件人初始化、延迟操作订阅与销毁；没有实施主动调用或修改生产发送路线。第二轮正观察上述5个入口，结果需后续补充，不能预填通过。

仅离线分析，尚未更换云端发送算法，没有完成关闭窗口后的新实发。

`decompiled/` 新增：

```text
fishbot_3de3cb0.c  // submit前置校验候选
fishbot_3de4310.c
fishbot_3de4d00.c
fishbot_3de5d90.c  // 构造带controller引用的异步任务
```

从已有 `fishbot_3de3b00.c` 可见，当前 submit 依赖 `controller+0x10` 及其 `+0x2a0` 服务。`3de5d90` 创建任务、复制列表和共享引用，任务虚表常量 VA 为 `0x189768a28`（RVA `0x9768a28`），随后调用 `3de62d0`。这是静态线索，不是新的可调用发送接口。

建议接续：分析任务虚表的执行函数、`3de62d0` 和会话服务取得路径，确认能否用正式的会话服务/工厂取得不依赖可见窗口的发送上下文。也可检查 controller 构造器的调用者如何获得第二参数模型。不要复制悬空 controller、改收件人字段、猜测 ABI 或直接调用这些新候选。

旧线程 Stalker 跟踪曾与不明微信退出时间相近，因果未明，默认禁用；不要为省事重启该实验。

## 验证证据

本地目录 `data/research/native/`；部分文件是被忽略的本地工件，不保证随仓库同步。缺失就明确缺失，不能重造“通过”记录。

| 证据 | 实际范围 |
| --- | --- |
| `cloud-filehelper-ai-evidence.json` | 云端 filehelper 自测，AI/发送/独立DB确认 |
| `cloud-friend-ai-evidence.json` | 真实好友普通来信，无前缀；回复ID `3377389688802672117`；独立DB核对 |
| `cloud-group-ai-evidence.json` | 备忘录群真实成员@；回复ID `1361315241517005770`；独立DB核对；双窗口2目标就绪 |
| `cloud-all-railway-evidence.json` | 无白名单新群测试群B；回复ID `7596664783153859812`；仅Adapter DB回执，没有独立观察器复核 |
| `cloud-friend-target-failure.json` | IPC曾写死filehelper，已修复、旧实例暂停不重放 |
| `cloud-friend-discovery-failure.json` | 并行Hook导致初始化失败，停止旧自有helper后恢复 |

最后完整自动验证：56/56测试、typecheck、build通过，日志 `data/cloud-all-tests.log`。这不等于后台发送和微信重启恢复通过。历史本机30分钟长测6条探针回执成功，但10/180次健康不就绪，不能称长期稳定。

## 操作提示

在实际项目根执行：

```powershell
$env:PATH='<workspace>\.tools\node-v22.23.4-win-x64;'+$env:PATH
npm run typecheck
npm test
npm run build
```

离线扫描现在必须指定版本报告路径，逐字节搜索字符串相邻引用，避免覆盖其他版本报告：

```powershell
& '<local-user-profile>\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' scripts/research-wechat-native.py ..\.tools\research-weixin-4.1.15.56\Weixin.dll --output ..\.tools\research-weixin-4.1.15.56\static-report.json
```

远程 Windows SSH 默认 shell 是 cmd。执行复杂 PowerShell 时用本地构建脚本、UTF-16LE Base64 后 `powershell -NoProfile -EncodedCommand ...`，避免本地 `$变量` 被提前展开。先只读检查 `/health` 和进程；不要展示完整 `.env`。读取 JSON 数组建议用 `Invoke-WebRequest -UseBasicParsing` 的 Content 再 ConvertFrom-Json，避免 Invoke-RestMethod 数组包装导致整组匹配的假确认。

新路线的完成条件：在服务器对应聊天窗口未打开/已关闭时，由真实其他账号发来消息，AI产生回复，一次原生发送并取得同目标/同正文的新回执；最好用独立快照复核。分别验证私聊和普通群，不把只在打开窗口下成功当作解决。
