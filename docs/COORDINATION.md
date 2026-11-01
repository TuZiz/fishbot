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

# 2026-11-01 后台发送 / 图片接入协调

## 图片短时间防重复保护已部署（未重启）

用户要求禁止短时重复生图，本聊天新增rate-limit模块、settings两项默认时间、engine接收预留/阻断、Store.accept(false)不取消原队列及conversation付费前检查。云端5dist文件SHA/导入/内存限流通过，备份image-rate-before-1793511573，90测试通过。默认同会话或用户单活动任务、60秒冷却、同内容/原图5分钟去重、15秒提示节流，重复图片不会abort原任务。未触碰.env/persona/native/wxgf/cached-format/client/runner/supervisor，未暂停/重启/另附加helper/付费。待用户MCS重启一次；不要旧包覆盖新的5文件或settings默认项。

## 铁路群真人引用改图+等待提示已完成

用户服务器打开原图后索引/候选0→1，最新真实@输入2478779474649696448完成等待提示3481724806359136632和图片668706472711166819，均sent/attempts=1。独立快照匹配等待正文、同目标图片MD5/ID，errors=[]；输出目视为保留主体并改为火星背景。user远端满意度仍待反馈，图片关闭窗口未验。没有第二helper、不重启、不改native/.env，旧拒绝任务未重放；保留新等待/自然意图与终端日志代码，不用旧包覆盖。独立证据group-image-wait-edit-confirmed.json。

## 铁路群截图拒绝改图：缓存未就绪

已使用只读快照和image-reference-worker复核，当前两条新引用输入身份/MD5正确，但该原图hardlink索引0条，候选0，尚未付费调用。请用户在服务器微信打开原图下载，待回复后先复核缓存。诊断没有native附加、没停机。只更新dist/images/conversation.js缺原图反馈，SHA/语法通过，下次启动生效，未覆盖client/wxgf/cached-format/.env/人格；86测试通过。勿将本次拒绝误报成图片模型编辑失败或自动下载已实现。证据group-reference-cache-missing.json。

## 等待提示和截图自然改图修复已部署

本聊天按用户新要求改dist/core/delivery.js、conversation/engine.js、images/conversation.js、images/intent.js共4文件，先发等待文字再调用API，引用图自然背景修改指令路由到edits。完整85/85通过；4文件SHA与导入/意图冒烟通过，备份image-wait-before-1793510869。没有改native、.env、最新persona、wxgf/cached-format/client或终端转发，未重启/暂停主实例、未开helper、未实发/付费。等待用户MCS重启一次加载本次和上一轮终端日志更新；不要旧包覆盖这4文件，不重放截图旧请求。

## 终端日志增量已部署，待用户重启原MCS

用户要求面板显示消息内容/收发结果。本聊天修改activity监控、engine/delivery/application/config、supervisor转发、start-server提示和run-cloud-all目录名称映射，共8生产文件，云端SHA/导入通过。未改native/windowless、.env、persona和图片解码/提示文件（哈希保持），未暂停/重启、未附加helper。81项测试通过；备份terminal-before-1793510648。下一次MCS自然重启将加载，不应覆盖上述8文件为旧版本。本聊天会让用户重启一次验收终端显示。

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


## 群窗口条件已获用户明确确认

用户明确回复本轮服务器备忘录群窗口已关闭、停在其他会话；本轮真实@入站3498811319557008535→sent/attempts=1→回复5391333757526935367已有独立DB快照。故无窗口群文字自动回复验收通过，main-memo-group-acceptance.json已记录窗口条件为用户确认来源。主8765保持运行，未重启、未另附加。此前待确认描述为历史；不扩大到无窗口图片或客户端重启恢复。

## 主8765备忘录群本轮核对

用户本轮在备忘录群@（非铁路），已直接从主8765与独立快照确认新入站3498811319557008535、mentionedBot=true、sent/attempts=1、新回复5391333757526935367，errors=[]。关闭窗口条件尚待用户确认，证据windowsClosedByUser=false。本聊天仅部署独立verifier脚本，不改.env、不改图文JS、不重启、不附加第二helper。主服务继续运行。

## 2026-11-01 12:39 真人私聊生图与引用改图验收通过

用户完成新一轮两步测试并确认两步均正常。随后只读核对云端主 8765：两个真实图片任务均为 sent、attempts=1，属于同一会话；新生成图片回执 `1980677300078496706`，引用该新图编辑后的图片回执 `5302605910866322933`。队列记录是微信本地数据库确认，用户反馈补充了远端实际收到和流程可用的证据；未把此前失败请求重放。脱敏现场记录在云端 `data/research/images/live-image-status.json`。

当前主服务健康，windowless backend、图片能力开启、备用 sunburst 生图、7890 代理生效，paused=false、dryRun=false、全量会话开启。最终完整测试 72/72 通过；本次验收只更新文档，不改运行代码、不重启主服务。后台群补验继续由另一聊天使用现有主实例执行。

仍未完成普通收到照片的 V2 DAT 原图提取；当前引用编辑支持同会话、已确认发送并留存原图的机器人生成图片。图片发送在目标聊天窗口关闭条件下未单独实测，不把 windowless 路径名称当成该条件已验收。旧日期段落仅保留研究历史，以本节最新状态为准。


## 主实例交还后本聊天只读核验

已收到图片任务明确交还，随后独立SSH核查主8765：ok=true、wechat-native-windowless、requiresChatWindow=false、imagesSupported=true、paused=false、dryRun=false，队列sent=2。当前inboxError=null；保留一次快照源变化历史计数，不冒充零错误。已请用户关闭服务器铁路群窗口，由另一成员真实选择器@发送新标记“后台群聊验收1101B”；尚未收到完成答复，不标记通过。本聊天不启动8766/helper，不覆盖.env或统一图文JS。独立verify脚本新增 --main-runtime 只读8765选项，配合 --railway-test-group，后续按新入站ID核对，不能将旧私聊或图片回执算作本轮群验收。

## 给统一通道部署任务的 MCS 恢复信息

已收到图片任务报告：windowless 可选图片分支的新回执2263122352628582260；filehelper当时仍打开，因此不能称图片关闭窗口验收通过。仍由图片任务占用环境，本聊天不启动任何服务。

此前实际恢复方式一直是**用户在 MCS 面板点击 FishBot 实例的启动/重启**，然后本聊天通过 SSH 核查8765；本聊天未使用过MCS API，项目中未发现现成授权API脚本，不能提供猜测的API调用或冒充能自动点面板。实例工作目录 `C:\wx\fishbot`，启动命令 `C:\wx\tools\node\node.exe C:\wx\fishbot\scripts\start-server.mjs`。脚本依赖cwd加载.env，MCS工作目录必须正确；不能省略scripts目录。

恢复顺序：图片任务完成部署并确认自己所有helper退出 → 由图片任务处理其创建的 `C:\wx\fishbot\data\STOP`（确认没有其他维护拥有者后移除）→ 用户在MCS启动/重启原实例 → SSH只读核查端口8765归属、/health、backend与requiresChatWindow、imagesSupported握手及日志。不要在SSH另起不受MCS管理的Node；不要把API监听正常当成微信发送成功。`.env`目标开关为 FISHBOT_CLOUD_ALL=true、FISHBOT_WINDOWLESS=true、WECHAT_NATIVE_IMAGES=true，后两者是否部署启用以图片任务最终交接为准。主实例恢复后本聊天可继续铁路群关闭窗口补验，不需要再开8766重复附加。

用户此前已授权全量无白名单回复；这些测试scope只用于隔离验收，不应覆盖生产全量配置。本轮新增铁路profile的Python选择许可若被图片任务部署，请合并保留，避免用其旧host副本覆盖。

## 后台群聊补验准备（用户已澄清群名）

用户已明确上一轮发送在“测试群B”，不是“备忘录”。群无窗口验收缺失的原因是隔离范围不一致；不能标记群发送失败，也不能标记通过。本聊天新增 `run-cloud-filehelper.mjs --live-friend-test --include-test-group --railway-test-group --windowless`，配套核对命令为 `verify-windowless-runtime.mjs --railway-test-group`。两者均选择 `test-group@chatroom`，使用独立 cloud-railway-profile，不覆盖原 friend/all profile。Python host 只增加该配置文件名与已授权群 ID，未覆盖图片分支；未编辑 windowless-agent.js。

本轮只读云端核查：8765/8766 均无监听、STOP 存在、微信进程存在；另一个图片聊天仍 active，尚未交还环境。本聊天未同步/启动这些修改，继续保留 STOP，不启动 helper。图片任务恢复统一服务时请保留后台文字路径；若已恢复统一服务，应先交接端口、helper、开关和真实证据，再安排铁路群关闭窗口补验。

## 图片任务最新独占阶段

后台发送聊天已收到图片任务交接：图片任务报告完整文件工厂单条合成PNG实发获得同MD5新图片ID `7545803196978937195`，并称原helper已退出；此为该任务报告，本聊天未另行复核，不扩大成windowless图片发送已通过。

本聊天当前不编辑`native/windowless-agent.js`，不启动8765/8766或新的native探针，不删除STOP。该JS接下来由图片任务在其用户授权范围内添加可选图片分支；后台发送聊天恢复前应先读取图片任务最新文件和证据，不能用本聊天旧副本覆盖新增图片代码。此前已验证文字路径应保留，图片能力应保持默认关闭，待该任务自己的握手和新回执验证通过后再决定启用。

本聊天的群入站补验仍等待用户确认实际测试群，待图片任务交还环境后接续。此记录仅确认文件当前无人并行修改及本聊天让出运行环境，不代替图片任务自己的用户授权。

后台发送聊天已读取图片聊天发来的维护说明。主8765由图片任务设置STOP并关闭，不是后台发送探针造成的已确认崩溃；STOP归图片任务所有，本聊天不删除、不恢复主服务。

当前安排：

- 后台发送的filehelper无窗口单条已实发并独立回读：4884557870524647667。
- 好友窗口由用户关闭后，真实私聊→AI→windowless发送→独立快照通过：输入491229873540567784，回复4649998093315991004，attempts=1。
- 用户回复“两条都发了”，但备忘录群独立快照没有本轮新入站，暂不能通过群无窗口验收；已询问实际发送群是测试群B还是备忘录，等待回答。不能把“无入站”当发送失败，也不能当通过。
- 为让图片任务执行独占原生探针，本聊天已先通过/control暂停8766，核对队列没有pending/sending，再按端口拥有者、路径、命令行、父PID核对并停止自有windowless测试Node及其Python helper；该旧runner没有HTTP shutdown端点，因此本次为已核验的空闲进程停止，不称优雅IPC退出。没有停止微信，没有删除STOP，没有恢复主服务。
- 后台发送聊天不再启动新的helper，直到图片任务完成独占图片实发并通过本文件或AI_HANDOFF交接。图片任务可读取本文件作为8766已释放的事实，仍须自行复查端口/进程。

共享代码边界：windowless-agent.js为新的全局纯文字发送路径，不支持图片。memo-agent.js图片分支属于图片任务，不覆盖、不移除。probe-cloud-native.py已保留图片CLI分支，并新增--windowless选择独立JS；两种模式不混报能力。run-cloud-all.mjs已增加FISHBOT_WINDOWLESS选择，但生产.env尚未启用该开关，不能说主服务已切为后台发送。

建议图片任务先完成其已授权单条filehelper图片实发，不重发此前unknown图片。随后明确统一helper与部署方案：文字可用windowless，图片仍未证明不依赖窗口；不要为了恢复图片把文字后台发送结果抹掉，也不要宣布两者均无窗口可用。恢复MCS前双方先复查最新共享源文件和生成产物。

本聊天未获得本聊天用户直接授权向图片聊天发送消息，因此未使用跨聊天发送工具；通过共享文件提供事实交接。
