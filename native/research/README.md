# Native Hook 研究记录

## 当前结论：测试好友/群原生通道与真实群@接收已回读

本机Windows微信4.2.0.12 x64，Weixin.dll SHA256：`2b3677c3f932daaa4ef84c8b2acd0aee12cbe5a779ff9e740c370761e5c291ce`。未知版本/指纹拒绝，不自动回退偏移。

2026-10-31 18:14的两轮真实AI自动回复已有独立DB观察器比对；18:31再次重附加，无预热原生发送获新消息ID。回复发送完全由程序原生调用完成；先前Computer Use只用于已授权的合成输入。未验收远端手机送达。

### 生命周期与所有权

- `native/context-registry.js`：在512MiB上限内扫描精确已验证虚表，校验QObject private自指针、发送服务和明确测试目标；唯一匹配才可发送。观察构造器和已验证删除析构器，析构开始即剔除对象。已结束扫描后仍可观察新建对象；这不是通用会话API。
- 相关静态证据：虚表RVA0x9881d28、构造0x3e86300、删除析构0x3e8edb0。证据位于controller-lifetime-static.json和decompiled/；不把静态分析单独当作运行成功。
- `native/memo-agent.js`：每次发送重新校验目标及对象，在已验证主窗口UI线程的DispatchMessageW返回时执行。文本工厂首参数离线确认未使用，传null；submit模式1有真实调用观察。QString/shared_ptr/QList使用已验证所有权路径，异常清理不完整则桥接停止。
- 取消旧5分钟预热TTL；不再缓存预热工厂对象。无预热发现/发送实际证据为no-warmup-evidence.json。对象校验不代表永久存活，也不保证任意后台会话都存在控制器。
- `native/discover-client.ps1`只读重识别现存进程、模块、窗口和版本。每次附加重新定位PID/基址，多个候选拒绝；没有可用主窗口或UI线程时拒绝。

### 恢复与发送保护

- RecoveringNativeBridge每2秒心跳，断线指数退避至60秒；启动、停止、重连及发送串行，代际变化取消未执行请求。恢复不重新发结果不明的消息。
- NativeMemoBridge将请求绑定具体子进程，等待helper退出后替换，子进程输入管道错误、初始化失败、协议损坏和detach均使旧上下文失效。UTF-8 JSON-lines，不记录正文或密钥。
- 接收Observer按每个目标建立基线；Worker异常从本进程已确认的游标恢复并抑制重放。整个程序重启重新建立基线，不保证补收停机历史。接收不健康或尚未建立目标基线时拒绝发送。
- 回执必须是同目标、同正文、新事件、非零数字ID的自己发送记录；跨会话相同正文不能确认送达。原生返回不等于发送成功；unknown保留供核对，不自动重试。
- 未修改磁盘DLL、登录信息或微信原始数据库。原始DB仅只读快照，在临时副本解密。旧线程跟踪仍禁用。

### 测试范围与阻塞

私聊“备忘录”已核对为测试群中的真实其他好友。此前仅转交自己发出的`鱼测试：`前缀消息，仍不能当作其他好友来信闭环。本轮runner会区分自账号和测试好友模式；测试好友真实来信将进入私聊引擎，普通自己的发出消息不触发。用户授权的唯一同名普通群可以显式`--include-test-group`纳入白名单，按真实ID与类型隔离；其他成员来信保留原始senderId和@字段，自己的普通群消息不触发。

早期仅有一个有效控制器，群原生探针拒发。后来手动双击测试群打开独立窗口，再在主窗口保留测试好友；修复对构造时尚未绑定目标的有效QObject的跟踪后，helper重附加无需预热获得两个控制器。好友和群两次原生发送均有新DB回执。此操作只打开窗口，未通过桌面发送消息。仍需保留这两个会话窗口，不保证任意关闭窗口后的后台群发。`readyTargetCount`为实际就绪目标数，整体connected不代表两个目标都能发。另一名真实群成员的普通消息及真实@消息已从DB进入引擎，保留成员ID，@消息已有AI回复入队；早期AI回复因无群对象拒发，后续原生群通道已通过；随后两轮真实群@已完成AI自动原生回复，独立快照回读通过。仍需验证群发出、切换会话、更多成员及引用；引用类型49尚未解析，代码不伪造引用识别。测试好友真实入站、其他好友、图片、真实客户端重启、远端设备和Server实机均未验收。

30分钟原生发送持续测试已完成，6条探针均确认但10/180次健康不就绪，连续健康未通过；最终以native-soak-evidence.json和独立native-stability-report.json为准，未满时长不能通过。该测试的旧服务进程与最终恢复代码的后续重附加验证分开记录。

### 本机运行

```powershell
npm run build
$env:FISHBOT_PYTHON = '<local-user-profile>\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
node scripts/run-native-memo.mjs --enable-native-memo-test --live-send
# 只有明确授权、唯一同名普通测试群时可追加 --include-test-group
# 未指定 --live-send 仍为DRY_RUN
node scripts/soak-native-memo.mjs --live-send --minutes=30
# 另一个8765只读观察器已订阅备忘录时，独立核对：
node scripts/report-native-stability.mjs
```

8766使用现有管理令牌，等待扫描ready后在私聊备忘录发送`鱼测试：你的问题`。无需预热。授权的POST `/api/native/reconnect`只重建FishBot helper，不退出或操作登录。Ctrl+C关闭服务并卸载Hook。实验独立DB、关闭记忆/图片、重启取消旧pending。普通8765继续Mock/只读观察。

本机忽略文件：data/wechat/key.xml（DPAPI）、storage-path.txt、native-targets.json、data/research/native/test-target.json、process-metadata.json；不提交ID/地址/密钥。Python依赖在外层.tools/hook-research，不随Node构建产物发布。

### 验证与证据

- 46/46自动测试、TypeScript、构建、生产HTTP/IPC冒烟通过；模拟测试不代表微信验收。
- no-warmup-evidence.json：真实无预热发送回读。
- native-memo-ai-evidence.json：此前两轮AI闭环，三次1337 Token用量，12秒无回环观察。
- group-transport-evidence.json：当前群探针结果，未就绪不发送。
- native-soak-evidence.json：真实墙钟和每条原生探针回执；native-stability-report.json：第二观察器核对。
- native-memo-test.sqlite保留真实sent/unknown/not-sent，历史中文IPC失败未重发。
- tests/native-{memo,recovery,bridge}.test.ts与database-observer.test.ts：目标隔离、基线、串行关闭/恢复、未知不重试、游标恢复及真实子进程清理。

以下为较早实验记录；其中“发送器未实现”等结论已被上面的实测取代。之前的实验线程跟踪仍禁用，不重新启用。

2026-10-31，用户明确授权研究本机Hook，测试限定测试账号与文件传输助手。未使用computer-use、键盘或OCR，没有读取登录凭据，没有自动发送微信消息。

## 本轮实际工作

- 读取运行模块元信息，确定Weixin.dll为4.2.0.12、x64，并记录SHA256。
- 下载并只读审查mosheng20205/WechatHook4.1.10.27源码。其SendText依赖消息对象、构造器、虚表、参数包装器和统一分发函数，不能仅替换一个RVA。没有运行下载目录中的程序或脚本，也未复制参考实现进运行模块。
- scripts/research-wechat-native.py用pefile和Capstone离线解析导出、PE异常目录、文本类型及newsendmsg相关数据引用，保存静态候选证据。静态字符串引用不等于可调用的发送函数。
- native/research/observe-sends.py通过Frida安装临时计数观察器。操作前校验客户端版本、磁盘SHA256、候选静态证据及运行时代码前16字节。观察器只统计调用次数和返回地址，不读聊天正文或函数参数，不修改返回值，不创建NativeFunction、不主动调用微信函数。
- 第一轮2个候选、第二轮5个构造/复制候选。用户两次从电脑文件传输助手手动发送合成测试文字；数据库监听确认文字已发送，但候选观察计数均未命中，不能推断发送入口正确。
- 脚本退出时detach全部Interceptor、卸载脚本并断开附加会话。事后确认微信进程仍响应，原Weixin.dll哈希未改变。

## 当前结论

原生观察Hook的安装能力已经实测；实际文本发送入口、ABI、接收者/正文对象布局、调度线程、生命周期仍未验证。没有实现微信发送器，自动微信回复仍未接通。不得把观察Hook安装成功说成发送接口可用，也不把旧4.1偏移放入4.2运行路径。

## 文件与证据

- scripts/research-wechat-native.py：离线PE分析，仅操作文件。
- native/research/observe-sends.py：经授权的本机临时观察实验，不是生产发送后端。
- data/research/native/weixin-static-report.json：模块指纹与候选反汇编。
- data/research/native/runtime-observation-round1.json、runtime-observation.json：两轮真实计数。
- data/research/native/summary.json：脱敏总结，senderImplemented=false。

Python工具装在工作区外层.tools/hook-research中，不进入FishBot生产依赖。实际加载版本：pefile 2024.8.26、Capstone模块5.0.7（分发包5.0.9）、Frida17.25.0。Python语法检查通过。由于本轮没有改TypeScript运行模块，不重复执行之前通过的20项测试。

继续适配需要验证实际发送调用链，而不是继续盲加字符串候选或直接调用构造函数。需要明确发送边界、对象所有权和执行线程后，才能在文件传输助手进行一次主动发送及数据库回读测试。

来源：https://github.com/mosheng20205/WechatHook4.1.10.27 、https://frida.re/docs/javascript-api/

## 2026-10-31 备忘录测试与实际线程轨迹

用户进一步授权向备忘录发送合成测试消息，并允许使用computer-use控制桌面以辅助研究。使用computer-use技能操作可见会话，发送两条合成测试文字C1026和D1026，界面均显示消息气泡。此行为是受控桌面测试，不属于无人值守发送后端。

随后通过DispatchMessageW识别发送键并对对应UI线程做1.2秒调用统计。GetCurrentProcessId拦截自检通过，发送键事件1次，记录2659个Weixin.dll调用目标。只记录地址/次数，不读取消息正文或登录凭据。静态筛选结果见executed-send-labels.json、executed-send-disassembly.json；message::send_text_message相关静态结构见native-api-candidates.json，尚未确认其可调用ABI，不能当发送接口。

再次附加新观察器时，Frida报告Unable to allocate target memory；检查发现旧微信进程已不存在。当前不能确定退出原因与线程跟踪之间的因果关系。已停止该附加任务，不尝试绕过保护；线程跟踪脚本现在默认禁用，需显式实验标志才能运行。

已通过computer-use启动原有微信程序，停在登录确认页面，交由用户完成身份验证。后续不重复该线程跟踪，先恢复只读接收并使用更小范围的观察。


## 本轮最终实测结果（2026-10-31 19:06以后）

- 已真实运行30.00025分钟（1800015ms），180次健康采样。6条定时原生文本探针均最终sent，另一个只读数据库观察器逐条核对消息ID及正文通过。
- 连续健康验收未通过：10/180次不就绪，原始passed=false原样保留；包括切换/失效及主动helper重附加，部分接收短暂异常在旧进程中没有保留具体原因。末段析构计数=1、目标就绪数=0，发送保护生效。不能称为已达到无人值守长期稳定。
- 两轮真实群成员@ → AI决策/回复 → 原生发送已有独立数据库快照确认。测试好友与群成员确为同一位其他用户，身份已核对。
- 最终恢复/好友来信代码46/46测试、编译、构建及生产HTTP/IPC冒烟通过。长测服务进程早于最终TS修订，不能将其长测结果冒充最终代码已满30分钟验收。
- 最终服务重启时旧进程正常退出耗时超过最初15秒观察上限；新原生测试服务尚未完成启动和好友来信验收。用户随后按Esc停止Computer Use，停止桌面操作并停止该未验收原生测试服务，不操作微信登录。
- 仍待验收：最终构建下真实好友入站自动回复、真实引用结构/检测、整个微信客户端重启后的恢复、关闭测试聊天窗口后任意会话发送、更多群成员与Server实机。引用未捕获到可验证结构，未宣称已实现。
- 持续测试原始证据：data/research/native/native-soak-evidence.json；独立对账：native-stability-report.json；真实群闭环：group-runtime-evidence.json；DB Worker恢复：database-recovery-evidence.json。


## 继续验收：启动阻塞修复（2026-10-31 19:15）

发现独立实验端口预占使用裸net.Server，健康探测在应用就绪前建立连接时可能留下未读socket，导致端口交接close等待；这解释了前次最终服务启动没有监听完成的一条实际路径。已改为reserveNativeEndpoint，立即销毁预占期探测连接；新增真实TCP连接及重复绑定保护测试2项。48/48自动测试、typecheck、build与生产HTTP/IPC冒烟通过。

修复后真实服务约5662ms返回健康接口。微信当时进程存在但无主窗口，helper如实进入backoff；用户手动打开主界面后，恢复独立测试群窗口和主窗口测试好友，自动重附加无需发送预热消息，readyTargetCount=2、connected=true。实际扫描存在2个失效区间错误，未伪装零错误；发送只使用每次重新校验的唯一有效对象。启动证据resumed-startup-evidence.json，就绪证据resumed-ready-evidence.json。

上一轮按Esc停止只属于当时状态；用户已重新授权继续控制，当前独立原生实验服务重新运行，仅对已授权测试好友和群开放。新版真实好友来信验收仍在等待对方发送，不把前缀自测当作真实入站。


## 真实好友验收及桥接故障恢复（2026-10-31 19:29）

- 已区分同名私聊和群：19:25对方账号的真实私聊入站进入引擎，DeepSeek回复经原生后端一次发出，队列sent，独立8765观察器按新消息ID和正文核对通过。验收文本未严格使用建议标记，报告acceptanceMarkerMatched=false如实保留；真实source、非self、好友身份和回复回执均匹配，不依赖标记判定来源。证据friend-runtime-evidence.json。
- 19:18真实群成员@触发的第三轮AI回复已刷新独立快照并确认；旧快照窗口之外的历史消息不因新快照未包含而重宣称失败，历史两轮已确认结论保留。引用仍未捕获可验证结构。
- 强制退出FishBot自己的Python memo-host子进程，按父PID、进程名、完整脚本路径、创建时间及8766端口归属复核后才终止；没有退出或终止微信。最终构建自动重建helper并恢复两个目标，检查全程约19.447秒，微信进程集合保持不变。证据native-helper-recovery-evidence.json。
- 首次恢复探针在原生调用后未及时获得可用回执，队列保留unknown、attempts=1，不重发；后续独立观察器和只读快照确认该消息实际存在。原始结果与后续核对分别保存，不能将unknown篡改成sent。证据native-helper-recovery-send-evidence.json。这条实际失败不足以确定唯一根因。
- 排查发现读取器会越过server_id=0的自己发出行，之后不会再读取原行补齐的ID。已新增最多200条待确认local_id检查点，在后续快照重读；不阻塞更晚好友入站，不回放基线以前的旧消息；Worker恢复携带待确认检查点，同进程重启可恢复，整Node重启仍不追补旧消息。针对ID补齐和检查点恢复新增2项回归测试。
- 修复后50/50自动测试、typecheck、build、生产HTTP/IPC冒烟通过，日志data/native-receipt-*.log。最终构建下再次强制helper退出并恢复，随后原生探针一次sent，独立观察器匹配相同新ID，约2.46秒完成。证据native-text-probe-evidence.json。未重新执行最终构建30分钟长测，旧版10/180健康中断结论不变。
- 可重复工具：node scripts/probe-native-helper-recovery.mjs --terminate-owned-helper --parent-pid=<当前实验runner的PID>；node scripts/probe-native-text.mjs --live-send。前者主动终止且仅终止已验证的自有helper，不发送消息；后者仅向已授权测试好友发一条明确标记的合成运输探针，不伪造好友来信，unknown不重发。需独立8765观察器正在监听该好友。
- 当前8766仍运行受限原生实验服务，仅允许授权好友与普通群两个测试对象，保持对应聊天窗口；记忆和图片关闭，普通8765仍为Mock/DRY_RUN入口。尚未证明远端设备收到、任意会话后台发送、真实引用、图片、完整微信退出重启、Server实机或无人值守长期稳定。

## 云端 WeChat 4.1.15.56（2026-10-31）

2026-11-01真实好友验收准备：已核对“测试好友”唯一私聊ID为`test-friend`，用户在服务器打开对应会话。首次并行发现时旧filehelper helper仍附加，运行时字节校验拒绝，随后status RPC不存在；未尝试发送。核对旧8766队列无pending/sending，并按端口拥有者、完整命令行、父PID验证后仅停止测试Node21148及其Python17276；主8765未停止。重新附加后唯一好友上下文ready=true、扫描0错误。失败记录`data/research/native/cloud-friend-discovery-failure.json`。

`run-cloud-filehelper.mjs --live-friend-test`现支持唯一授权好友模式，8766、独立DB、无前缀、只转交该好友的非self入站；helper使用独立`cloud-friend-profile.json`，IPC硬限定两个既有测试ID且实际发送还需匹配所选profile。好友模式已启动（Node7264）；真实来信闭环仍待触发。客户端PID/线程固定、没有重启恢复保证。后续清理初始化失败时只有已验证RPC导出存在才调用dispose，防止清理异常覆盖原失败；Python与runner语法检查通过。

2026-11-01原生单条实发通过：`probe-cloud-native.py --execute-filehelper-test`对唯一已校验的filehelper上下文调用文本工厂/提交，返回`attempted=true,nativeReturned=true`，另一进程8765数据库观察器按合成标记回读到自己发出的新消息ID `6155790099544170331`。当前微信PID9872、已观察提交线程1432。消息虚表RVA `0x9026b48`、控制器虚表RVA `0x9768888`由合成消息实测确认。收件人通过`controller+0x10`会话对象的`+0x260`校验，控制器直接`+176`诊断是错误路径，不能作为版本布局变化依据。只读发现扫描约162MB、0扫描错误、唯一filehelper目标就绪。

已新增隔离AI入口`node scripts/run-cloud-filehelper.mjs --live-filehelper-test`，端口8766、独立SQLite、只允许filehelper、仅转交自己的`鱼测试：`前缀消息，图片和记忆关闭，队列以新数据库避免重放旧任务。使用已有NativeMemoBridge/NativeMemoAdapter确认回执和unknown不重发；适配器现在允许显式目标名，默认备忘录行为保留。55项测试、typecheck、build通过；AI闭环此时仍待新消息触发。主8765仍为只读/DRY_RUN，不支持全量自动实发。此实验固定PID/线程/版本，微信重启后拒绝；不得宣称自动重连、任意好友/群或长期稳定已经完成。

2026-11-01输入链实测：用户明确确认测试在服务器远程桌面电脑微信执行。新增`observe-cloud-input.py`，绑定DLL SHA-256、校验函数前16字节，拦截GetCurrentProcessId自检命中1次。观察120秒，在用户发送合成测试文字后，输入候选`0x3e13d90`命中2次（调用返回点`0x1c0d787`、`0x1c155ba`），`0x3e147a0`命中2次（`0x3e1ab10`），`0x3e152b0`命中1次（`0x3e1739c`），正常分离。仅记录命中和返回地址，不读取参数或正文。故旧候选零命中不能再解释为用户从其他设备发送。

离线跨版本指令匹配找到4.2文本工厂`0x3ec5f70`对应4.1候选`0x3e22490`、4.2提交`0x3e863e0`对应4.1候选`0x3de3b00`。前20条指令屏蔽RIP位移和跳转位移后各唯一匹配，另已完成候选函数反编译；这些仅为候选，未据此调用任何发送函数。匹配文件、反编译文件位于`.tools/research-weixin-4.1.15.56/`。析构和列表追加存在多处匹配，不能直接迁移。

修复离线扫描器只搜索8字节间隔导致遗漏引用的问题，改为逐字节覆盖0到64；调用者扫描只搜索函数起始地址。新增必填`--output`指定版本报告，避免覆盖不同版本历史证据。运行新版扫描和2个研究脚本Python语法检查通过；没有改TypeScript运行代码，不把历史TS测试算作本次新测试。

2026-11-01复核：云端健康接口恢复，uptime约43692秒，75/75会话监听正常，仍为只读适配器与DRY_RUN。上一轮SSH启动器退出的原因没有获得确证，不能断言一定是SSH会话关闭所致。

本轮使用已有FishBotOffline工具对离线映射镜像完成4个函数的定向反编译，输出位于工作区`.tools/research-weixin-4.1.15.56/decompiled/`：`1a97a30`、`2aace30`、`4579450`、`55f0380`。构造函数`1a97a30`的调用者`2aace30`构造并复制消息源对象，涉及共享所有权；这些函数不能当作接收目标ID与文本即可调用的独立接口。此结果仅为静态证据，不证明ABI、线程、存活对象或发送成功。下一次动态观察需要先确认测试操作来自服务器电脑微信客户端，手机/本地发送不能替代该触发。

- 云端 `Weixin.dll` SHA-256 为 `E0428A7B691853DE496532523C2C09AA095F90941C37C9F4CFB3F137F3C66556`，与本地离线副本一致。离线扫描找到 `TextMessageSendSource`、`message::send_text_message` 和 `newsendmsg` 路径线索；静态报告仍为 `runtimeVerified=false`、`canSend=false`。
- 通过隔离目录安装 Frida 17.25.0，Wheel SHA-256 校验通过；PID 9872 的 attach/detach 自检成功，WeChat 进程仍存活。随后对三个已校验的候选函数只计命中、调用者地址和线程，不读取参数或正文，也不调用函数。180 秒内三处均 0 命中。用户报告期间向文件传输助手发送测试文字，但无法证明该消息由本云端客户端发出或经过已观测进程。
- `Weixin.dll` 只加载在根进程 PID 9872，四个子进程未加载该模块。被动观察期间 FishBot 的启动器、supervisor、应用进程及 8765 端口消失；微信进程仍存活。未找到应用错误级别日志，退出原因未知，不能据时间关联归因于 Frida。
- 当前不具备 4.1.15.56 的可调用发送器；没有启用 Hook 发送、没有实发、没有将该适配器接入持久队列。云端运行 Frida 包仅位于 `C:\wx\tools\fishbot-frida-research-17.25.0`，不得视为生产能力。恢复云端实例后，需要确认云端客户端内的测试气泡/数据库行，并从正确的调用链继续验证；未知结果禁止重试。
