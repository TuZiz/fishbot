## 2026-11-01 15:55：引用原图自动下载已部署（当前结论）

微信4.1.15.56当前精确DLL指纹已取得真实缺缓存证据：只读身份核验通过、请求前非缩略图候选0 → 程序原生kind3任务完成/resultCode=0 → 新快照候选1 → 微信解码MD5一致 → 有效JPEG，2,070,339字节。最终分文件生产下载模块独立加载、下载、解码及释放也通过。证据见 `data/research/native/quoted-download-evidence-summary.json`；单份探针中的保守字段不替代联结证据。

主8765已通过原supervisor滚动重启加载13文件增量，SHA校验及.env/全部settings（含人格）比较通过；connected/nativeReady/quotedDownloadsSupported均true、paused=false、dryRun=false。仅一个生产helper和一个supervisor，无8766监听、无残留下载研究进程。未改变现有后台文字/图片发送器和缓存解码器，保留全量无白名单、人格及图片限流。

触发范围仅为用户引用照片的改图指令：先确认等待提示sent，再读已有缓存；缺缓存时核验会话/原消息/作者/类型3/MD5后下载这一张。原图kind3优先，没有原图资源才考虑普通清晰图kind2，拒绝缩略图kind1。原生并发1、40秒任务期限，TS总等待45秒；取消/失败/unknown不重试，60秒同引用去重，暂停/上下文失效不进入付费调用。下载后重新快照查索引并核验MD5及图片格式。群引用fromusr为当前群时使用chatusr真实作者，不能把群ID当成人物；仍严格比对原消息作者。

本轮96/96测试、TypeScript检查与构建通过；完整日志 `data/research/quoted-download-final-tests.log`。新增等待回执不确定时不查图/不下载/不付费回归，原有单任务/去重/超时取消/身份错误等测试保留。本轮开发工具没有发送测试消息或调用付费图片API，不回放历史任务。新的生产“等待→未缓存下载→付费改图→回图”整体用户流程尚待一条新指令验收，不能将下载证据冒充整条付费闭环验收。真实下载中途取消、微信重启、长时间运行、其他DLL指纹尚未新增兼容性实测。

以下旧日期、旧“自动下载未实现/只支持已缓存”段落保留为历史，当前状态以本节及其真实证据为准。旧高层Hook隔离保持，禁止恢复旧RPC直接查询或重试已隔离入口。

### 已实现的所有权契约与代码入口

- 精确DLL SHA256为 `e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556`；另锁定18个入口的16字节指纹。代码只加载到唯一现有host，不另建发送进程。
- `native/quoted-image-task.js` 管理自有空操作/上下文、原消息future、照片metadata、descriptor和task。先在自有原生任务上下文中查询，query完成后再提交第二个自有任务建立下载描述，避免读取过渡态metadata。临时Hook只匹配自有上下文及空vector，不向原生队列传JS回调。
- 图像optional构造按值消费metadata共享pair，必须通过原生shared_ptr复制取得所有权，不能传model内借用pair。早期借用pair版本实际观察到metadata退化为基类，失败报告保留，修正后metadata类别及MD5稳定；不能重试旧错误方式。
- task model采用aliasing shared ownership保留future控制块；不伪造控制块、不手工增减计数。任务构造后核对model、owner、kind和server ID，再走正常start；完成要求resultCode=0。取消同样在自有任务上下文执行，结束才释放task/future/context/operation及临时Hook。
- `native/quoted-image-download.js` 负责单活动任务、期限、轮询、取消和释放；RPC只有start/status/cancel。`native/research/probe-cloud-native.py`将它装配进原host并校验会话目录与输入字段。`quotedDownloadsSupported`经bridge和Adapter透出到health。
- `src/adapters/wechat/database/quoted-image-downloads.ts`负责去重、并发、超时和无重试；`cached-image-references.ts`保留缓存解码入口，在cache miss时调用下载，结束后重新快照检查。下载期间不占用只读快照worker。
- `src/images/conversation.ts`确认等待提示sent后才resolve引用图；不确定回执不查图、不下载、不付费。`media-message.ts`在fromusr为当前群时取chatusr，原会话/作者/消息/MD5验证没有放宽。
- 独立模块验证工具为 `native/research/verify-quoted-downloader.py`；只读准备与缓存前后核对使用 `scripts/prepare-quoted-image-probe.mjs`、`scripts/check-quoted-probe-cache.mjs`，图片格式检查使用 `scripts/validate-downloaded-photo.mjs`。私有身份/缓存路径文件不进入文档或工具输出。

部署证据 `quoted-download-deployment.json` 与 `quoted-download-health.json` 已归档。第一轮更新复核失败后服务被部署器暂停；完善关闭请求响应中断处理、增加分阶段失败报告及复制失败回滚后，第二轮由原supervisor正常恢复并通过全部配置/文件验证。未杀微信或创建第二服务；第一轮失败记录与两次精确备份保留，不能把失败记录删除来声称一次成功。

## 2026-11-01：引用照片在正确任务上下文中查询、身份与MD5核验通过

新增研究工具 `native/research/probe-quoted-task-context.py` / `.js`。先提交不含消息的原生空操作，只拦截并匹配该操作复制的上下文与空向量；没有发送、下载或付费请求，也没有向原生队列传入 JS/NativeCallback。实测普通RPC线程当前协程为空，匹配任务内存在有所有权的协程、state=1。任务正常返回，临时Hook移除，自有操作/上下文释放。

随后通过相同任务上下文调用391a010，对已由只读快照核验的单张引用查询。实际得到消息，虚表、类型3、会话、发送者、server ID、local ID全部匹配；后续增加照片元数据类90a1f88及MD5比较，也与DB匹配。结果future及其消息包装在使用后按共享所有权释放。证据 `data/research/native/quoted-task-context-result.json`、`quoted-task-query-result.json`、`quoted-task-query-metadata.json`、`quoted-task-query-resources.json`。前三份为各阶段历史版本，最后一份对应最终MD5/资源验证版本。

这解决了“如何按引用ID取得真实消息模型”的证据缺口，**没有完成自动下载**。资源字段有值仅代表下载描述存在，不代表本地文件已缓存或下载成功。本样本 kind1/2描述存在、kind3描述为空。生产TS、配置、人格、发送器未改；最终8765只读健康检查ok/connected/nativeReady均true，backend=wechat-native-windowless。

下一步仅研究已核验引用图片的下载任务创建、启动、完成/取消和释放，并验证缺失缓存实际出现、MD5/解码有效后再接入唯一helper。无原图描述时必须明确区别普通图与缩略图，不猜枚举或将缩略图冒充原图。旧5个高层Hook及定向观察隔离不解除；RPC直接真人查询已在probe-quoted-query.py中于附加前硬拒绝，不能重试旧失败方式。

本轮实际验证：Python AST、嵌入JS/独立JS及Node准备脚本语法检查；真实任务上下文/引用查询/MD5与资源字段核对通过；RPC查询CLI隔离检查通过。本轮未改TS，未重跑历史90项测试，不将它们算作本轮证据。

## 查询上下文失败与修正的证据

`probe-quoted-query.py` 空future、空参数查询fast path实测通过，构造/状态/释放正常；直接RPC真人查询在query-call中访问异常，尚未返回future。微信未退出、主服务仍健康。该模式现于profile/身份读取和Frida附加前硬拒绝，不能为重试删掉门禁。

离线4a1fd0读取模块TLS索引bb94b20、TLS+1f0；该协程为空仍会解引用对象+388。4a3530是设置并恢复TLS+1f0/+1f8的协程执行入口，4a3db0调用对象+350保存的函数。5ad990/12e5040仅为trace scope，不能用作执行上下文初始化。离线工件在quoted-executor、quoted-dispatch-context、quoted-tls、quoted-coroutine、quoted-coroutine-entry/options、quoted-task-factory/owner/constructor、quoted-job/methods目录。

新探针使用已验证19b9d10/f910/19e5f00创建空向量操作，在19e66c0仅匹配自身上下文pair与空向量。用49f2f0安全取得当前协程共享pair，检查control虚表8fe22e8、object=control+16和state=1后释放。查询仅在匹配任务中执行；不从RPC调用真人查询，不修改TLS，不借用捕获的协程，不向原生队列放入脚本回调。超时移除临时Interceptor；原生空任务只持有其自己的原生对象。无下载任务的取消契约尚未验证，不能把空任务超时清理扩大为任意下载可取消。

元数据类虚表90a1f88在真实引用中确认。离线2303600解析XML：+248对应md5（常量908a69c）；+268对应cdnbigimgurl（9432370）；+290对应cdnmidimgurl（9432380）；+2b8对应cdnthumburl（8f71690）。37f4770分支选择kind3→+268、kind2→+290、kind1→+2b8，据此确认3=原图、2=普通图、1=缩略图；不能沿用此前猜测的2=原图。quoted-photo-class/quoted-image-metadata保存反编译证据。这是静态枚举证据及真实字段存在性验证，不是下载实测。

当前引用身份输入新增md5，来自quotedImageMd5只读DB校验，仍存于远端私有输入文件，不打印。探针只比较MD5并报告资源字段是否非空，不输出URL、AES字段、原始指针、正文或缓存路径。最终样本MD5匹配，kind1/2非空、kind3为空。不得声称原图字段为空就是CDN过期、下载失败或本地未缓存，以上均未得证。

## 2026-11-01：范围收窄为当前引用图，新增无Hook只读身份核对

用户明确只需要下载被引用的图片。后续触发必须位于引用照片改图请求内，先核验原会话、原消息ID、发送者、类型3和MD5；不做普通图片入站预下载、批量扫图或其他媒体下载。

新增scripts/prepare-quoted-image-probe.mjs：只选授权测试群最新一条照片引用，使用既有只读快照与quotedImageMd5核对，生成单张图片的身份比较输入，不输出聊天/密钥。新增native/research/probe-quoted-image-identity.py：精确DLL指纹、无Interceptor、无NativeFunction、12秒/512MiB扫描上限，只比较已核验引用身份，不输出内存指针或图片内容。云端实际准备通过；本轮扫描198815352字节、52个候选虚表、0个匹配引用对象、scanErrors=0。该结果只代表有界检查未发现对应对象，不证明全进程永久不存在，也不是下载验收。探针退出后主8765 connected/nativeReady仍为true；下载/发送/付费均0。报告data/research/quoted-image-identity-readonly.json。

离线沿实际虚表8f71468解析7个构造/复制/析构函数，又解析quoted-query、quoted-resource、quoted-loader、quoted-await工件。实际虚表槽+8为a888f0，经22ead90建立资源键；此前参考的22eafa0属于另一布局，不能套用。新布局中144/148/150各自语义必须分别核验，资源键复制150不能直接当作DB server_id。已定位391a010/39176f0按会话与svrid查询候选、17da070调用者、17dcd90结果等待和3991600/3993f70完成包装。返回值是带shared所有权的异步结果，并非消息裸指针；线程/等待/释放契约尚未运行验证，不直接从RPC调用候选或拼造消息模型。旧崩溃探针隔离保持。

自动引用原图下载尚未接通。当前缺口收敛为：无需打开聊天窗口，按已核验引用ID加载对应原消息，并以正确线程/所有权启动原图资源任务。生产TS与配置未改，不重放旧指令，不调用付费API。新增Node/Python/Frida JS语法检查和云端真实只读执行通过；未重跑未变更的TS测试。

# 未缓存原图自动下载：4.1.15.56 研究

## 2026-11-01 14:20：原图参数验证失败，探针已隔离，自动回复已恢复

备忘录群本轮手动加载触发了6条定向事件，但两个候选标识均无法匹配同群数据库消息，`identityVerified=false`；此前把对象字段称为消息ID的推断不成立。不得重放捕获对象或据此发起下载。

14:15:10（上海）云端微信发生访问异常退出（Application 1000，c0000005，模块unknown）；时间上与本轮Hook相邻，具体机理未确认，不能归因于用户操作。已停止观察，并在Python观察器硬拒绝这组高层RVA及image-target参数，PowerShell入口也拒绝定向观察；隔离版已部署云端。后续仅离线研究，不继续在生产客户端重复试探这些入口。

通过scripts/refresh-cloud-client.ps1验证相同4.1.15.56指纹，备份后仅刷新两份native profile的进程信息（9872→9340），保留参数、目标及登录状态。原8765服务自动重连；14:20只读复核ok=true、connected=true、nativeReady=true、backend=wechat-native-windowless、dryRun=false、paused=false。本次没有发送测试消息、调用付费API或重放任务，健康恢复不等于重新实发验收。

自动原图下载仍未实现；现有服务器已缓存原图→引用改图流程保留。下一证据缺口是真实消息包装对象/身份字段、资源枚举、线程与生命周期，离线解析完成前不接生产。失败核对见data/research/image-download-identity-failed.json。最后变更通过Python AST、Node语法、PowerShell解析；定向CLI实测在附加前拒绝。90项TS测试属于此前限流版本证据，本轮未重跑。


当前状态：**尚未实现自动下载，生产流程仍只读取已缓存原图。** 下面是离线线索和被动观察工具，不是兼容性验收。

## 已确认的离线证据

- 精确 DLL SHA256：`e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556`。
- 调用链：`0xe27450` → `0x29ad990` → `0x29adb60` → `0x29fc600` → `0x2a03290`。
- 日志字符串把前三层分别关联到 `mars::cdn::CdnManager::StartC2CDownload`、`CdnCore::start_c2c_download`、`CdnCore::_startDownloadMedia`；`0x29fc600` 是 `TaskFactory::CreateC2CImageDownloadTask` 候选。
- `0x29fd420` 配置下载任务；`0x2a03290` 分配带共享所有权的任务对象，调用 `0x4f8b3c0` 构造；响应处理线索在 `0x4f8b650`、`0x4f8bff0`、`0x4f8d7b0`。
- 这些入口依赖完整任务描述和服务生命周期，**不是“传入消息 ID 即下载”的已验证 API**。不能直接拼对象调用，不能缓存观察到的指针后重放。
- 已找到此前漏掉的高层引用：编译器用 `movaps/movups` 将日志字符串分块复制到栈上，只有 LEA/MOV 扫描会漏检。扩展 SIMD 扫描后定位 `GetAvailableImageSync` 的 `0x3b57960`、任务虚表 `0x9ad0278`、构造 `0x5bdc820`、恢复 `0x5bdd320`。
- 第二轮真实调用栈关联：`0x1820b20` / `0x1813980` → `0x181bee0` → `0x3a5c4a0` → `0x3a5cf00` → `0x3a5f200` → 构造器；恢复经 `0x3a56f90` 到 `0x5bdd320`。这是基于消息共享对象的资源任务链，仍需验证参数及生命周期。
- PE 异常表不包含所有叶函数，例如 `0x3a583c0` 与 `0xa87c00`；不能把缺少异常表记录当成函数不存在，也不能把前一函数范围强行扩展。叶函数已独立反汇编，尚未据此执行内部调用。

## 工具与验证

`native/research/research-image-download.py` 仅访问离线 DLL，按指纹锁定，扫描字符串引用、PE 函数边界及经指令边界检查的直接调用者。`--function RVA` 可以补充待查函数；`--summary` 仅打印计数，完整 evidence 写入指定目录。输出始终 `runtimeVerified=false`。

最初扩展扫描实际得到 18 个字符串锚点、16 个引用、4 个直接调用记录，选出 10 个函数并完成定向反编译。SIMD 扩展与显式虚表地址扫描后，一轮 task 报告为 77 个引用、6 个直接调用记录、21 个函数范围；后续 resource/model/identity/kinds 是另外的定向工件，不能把各轮范围数相加当成去重函数总数。工件在外层 `.tools/research-weixin-4.1.15.56/image-download/`；它们不属于运行依赖，不能分发为自动下载能力。

`observe-cloud-input.py` 新增 `image-download-candidate` 和 5～600 秒限时。默认只计命中、返回地址、线程；`--backtrace` 最多保存每个候选的三条模块内调用栈。可选 `--image-target` 严格限定授权测试群和类型 3，只比较 peer/recipient，输出消息 ID、类型、资源枚举和所有权匹配布尔值；不读正文、XML、缓存路径或下载凭据。未传两个定向参数时不读取参数。没有发送能力。退出时卸载观察脚本并 detach；不停止微信或现有生产 helper。新观察器支持研究 stop 文件，最长五秒内结束。

`start-image-download-observer.ps1` 只选择唯一加载 Weixin.dll 的进程，拒绝重复被动观察器，检查初始化自检和 prologue 后报告 ready。保持 SSH 会话到观察结束：本机实测 SSH 退出会使子进程被 Windows 作业回收，不能依赖 Start-Process 脱离 SSH。第一轮初始化 ready 后因 SSH 退出被回收，无完整样本；已改为有界前台等待。后续必须检查超过一个采样周期的日志，不能只把 ready 当成持续运行。

观察工具实际报错也须保留：第一轮完整采样 120 次、stderr 为空、completed=true，但 PowerShell 未提前持有进程 handle，进程退出后 ExitCode 为 null 导致启动器误报失败；已提前保存 handle 并检查退出码。第二轮 stop 参数拼接缺少括号导致引号内多出空格，不能提前结束；已将每个路径拼接表达式独立括号分组，并通过含空格路径的参数序列检查。以上是研究启动器问题，不是主服务或微信下载失败。

用户两次发送新普通图片并在服务器加载：第一轮 CDN 入口命中 3 次，图片任务工厂 1 次，实际线程 10988；120 次采样完成。第二轮高层构造/恢复均命中 3 次，模块调用栈 traceErrors=0；图片读取策略同时在 UI 1432 与工作线程 10988 命中。这里只证明客户端真实执行了这些路径，未建立具体图片 MD5 与调用参数对应，也未由程序请求下载。证据 first passive report 与原始 stdout 分别保留在 data/research 下。

上述手动加载观察是历史操作，已停止。不要据此要求用户重复发图或重启隔离探针；后续范围仅为当前指令引用的原图下载。

## 启用前必须具备的证据

1. 从同会话、发送者、原消息 ID、类型 3、MD5 核验后的原消息建立下载任务，不读取或导出新凭据。
2. 明确调用线程、ABI、对象所有权、异步完成/失败/取消路径；锁定版本与入口指纹。
3. 使用新图片证明请求前原图候选为 0，程序请求后出现非缩略图缓存，MD5 匹配、解码有效；已有缓存不算自动下载。
4. 接入唯一生产 helper，限制并发、超时、去重与重试；暂停或上下文失效后不进入付费改图。
5. 下载失败明确反馈；不重新提交历史失败、unknown 或付费任务。

本轮只变更研究工具，未修改生产 Adapter、native sender、配置、角色卡、图片 API 或现有缓存解码器；TypeScript 的 90 项通过属于上一轮图片限流证据，不冒充本轮新运行结果。
