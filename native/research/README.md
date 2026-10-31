# Native Hook 研究记录

## 最新结论：备忘录原生 AI 闭环通过

2026-10-31 18:14（Asia/Shanghai），本机Windows微信4.2.0.12 x64，Weixin.dll SHA256为 `2b3677c3f932daaa4ef84c8b2acd0aee12cbe5a779ff9e740c370761e5c291ce`。

已完成一次独立原生发送和连续两轮真实AI自动回复；均有新本地DB消息ID。`scripts/report-native-memo.mjs`将队列结果与另一个只读观察器的消息比对，报告data/research/native/native-memo-ai-evidence.json。测试问题通过Computer Use技能发送，生成的回复通过原生函数发送，没有键盘/OCR或Computer Use参与回复发送。未验收远端手机送达。

### 实现及边界

- native/memo-agent.js：捕获已验证备忘录的工厂/控制器，在实际UI线程DispatchMessageW返回时调用；检查模块代码与收件人，使用本版本真实QString、文本工厂、shared_ptr/QList和submit路径，释放临时所有权。未修改磁盘DLL、登录信息或微信原始数据库。
- native/memo-host.py：Frida生命周期与JSON-lines协议，仅接受明确实验标志；UTF-8管道，避免Windows默认GBK导致中文解码失败；退出时dispose、unload、detach。
- src/adapters/wechat/native/：仅转交指定备忘录以“鱼测试：”开头的自账号消息，并明确标记self-test来源。这是自测输入转换，不代表已经支持他人好友消息。
- 回复正文必须与新DB事件一致且具有非零数字消息ID才标sent；原生返回不等于送达。超时/异常标unknown不重发。第一轮中文IPC错误已保留为unknown，没有伪造成功。
- 通用入口维持Mock及默认DRY_RUN。实验使用独立数据库、限定白名单、关闭群聊/记忆/图片，启动取消上轮待发实验任务。

当前仍依赖一次 `FishBot_CONNECT_1031` 预热捕获对象，租期5分钟；这个租期是实验保护措施，不代表对象生命周期已被形式化验证。不要切换到其他会话后声称后端仍可用。过期、断线、客户端重启需重新验证，不支持通用群/好友/图片，也未通过长期稳定性测试。

### 本机运行条件

保留被忽略的data/wechat/key.xml（DPAPI）、storage-path.txt、data/research/native/process-metadata.json和test-target.json。后两者来自本机实际测试，不应提交会话ID、进程地址或密钥。微信重启后旧PID不能继续使用，需重新生成进程元信息并检查版本/模块。未知指纹拒绝运行，不自动回退到旧偏移。

Python依赖位于工作区外层 `.tools/hook-research`，不随生产Node模块打包。构建后执行根README中的独立实验命令。先预热，再发送“鱼测试：你的问题”；管理台在8766。Ctrl+C关闭测试服务并卸载Hook。普通8765管理台仍为Mock/只读观察。

独立取证脚本仅在8765另一个只读观察器已启动且订阅同一备忘录时运行；它读取两个本机服务并校验回执，不发送消息。25项自动测试不替代微信实测；两轮微信实测也不替代Server或长期验收。

### 已保留证据

- data/research/native/native-send-probe.json、native-send-db-evidence.json：单次主动原生发送及DB回读。
- data/research/native/message-layout-observation.json：合成消息的类型、布局和线程观察。
- data/research/native/native-memo-ai-evidence.json：两轮AI发送、两份观察器比对、3次1337 Token用量、12秒无回环观察。
- data/native-memo-test.sqlite：两条sent及一条unknown的实际队列结果；data/native-memo-run.log保留运行日志。
- tests/native-memo.test.ts：隔离、前缀、自回复防护、并发锁、早到回执、缺失ID、结果不明、关闭清理与Adapter注入/DRY_RUN保护。

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
