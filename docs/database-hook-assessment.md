# SweetCheckout v4 接入路线核查

> 当前进展：用户提供密钥后的只读数据库入站已通过；2026-10-31又完成备忘录原生发送和两轮AI回复闭环。普通后台的监听页仍不转发AI，独立实验入口才使用NativeMemoAdapter。下方“缺少密钥”“没有发送器”等是历史阶段记录。最新边界见 ../native/research/README.md。

2026-10-31，实际下载并只读检查上游源码，研究副本位于 data/research/SweetCheckout-main/wechat-hook/v4/，未执行上游程序或复制其代码到运行模块。

源码证据：
- DatabaseService.cs：解密后的SQLite以ReadOnly模式打开，查询Msg_表并通过Name2Id映射real_sender_id；仅保留两个收款服务号，解析支付金额，不是通用群聊适配器。
- DecryptService.cs：从输入数据库读取并输出解密副本，使用给定的数据库密钥，不提供聊天发送。
- README.md：其声明范围为4.1.0.34至4.1.2.17，不能证明4.2.0.12兼容。

更正前期判断：用户原要求禁止修改微信数据库，未禁止经授权只读数据库。数据库解密密钥也不应直接等同于登录Token。wx_key提取过程是否涉及注入、重启等，需要根据具体版本单独审查；本次未运行提取工具，不读取进程内存。

可行的下一步：用户在本机提供数据库解密密钥后，先验证只读解密副本，再确认私聊/群聊表、会话ID、成员ID、@、引用、消息ID与时间戳。未验证字段不得以昵称或当前时间伪造。主库与WAL一致性、数据库落盘延迟需专项测试。

当前阻塞：没有微信数据库密钥；4.2.0.12数据库格式及身份字段没有实测。已有DeepSeek API Key不能用于解密微信数据库。接收成功也不等于可发送，发送后端另需验证。

本机只读UIA实测：主窗口可见后rootClass为Qt51514QWindowIcon，仅2个Pane子节点、无第二层节点，未暴露消息或输入控件。报告data/wechat-uia-visible-probe.json。未修改辅助功能配置或登录状态。

第一方来源：
https://github.com/MrXiaoM/SweetCheckout/tree/main/wechat-hook/v4
https://plugins.mcio.dev/docs/checkout/install/backend/wechat-hook/v4/
https://github.com/ycccccccy/wx_key

## 数据库路线实测补充

用户提供了数据库密钥和路径后，密钥保存为 data/wechat/key.xml（Windows DPAPI加密），不写入源码或明文日志。路径配置位于被忽略的data/wechat/。

2026-10-31真实检查：六个数据库首页HMAC匹配；message_0、message_resource、contact、session四个临时解密副本quick_check=ok。12个Msg表全部能通过会话ID的MD5定位，抽样71条消息元数据无未映射发送者；唯一自账号通过Name2Id与账号目录交叉匹配确定，不假定rowid=1为自己。

新增只读后台监听测试：/api/wechat/start、status、sessions、watch、events、stop。后台“真实微信·只读监听测试”可选择最多五个会话（页面默认一个）。Worker线程读取原文件，逐页验证HMAC，校验WAL校验和并应用已提交帧，在临时目录查询后删除副本。源文件发生并发变化时丢弃本次快照并重试。首次订阅以最大local_id建立基线，不回放历史。仅接收普通文本，Zstd压缩文本可解码，保留64位消息ID；图片/引用等暂跳过并计数。

监听器已连接真实会话目录；尚需用户在指定测试会话发送新消息以验收入站。群成员与@解析有数据库结构证据和合成测试，不标为完整真实流程通过。无真实发送后端；监听事件仅在本机内存保留最近20条，不交给DeepSeek、不写入聊天引擎或自动发送。

编译/生产构建与20项测试通过；真实数据源启动通过。此功能不代表完整微信Adapter已完成。密钥解包由当前Windows用户的DPAPI完成，不读取微信进程内存或修改微信原库；启动和停止的是FishBot自己的Worker。

当前可通过 http://127.0.0.1:8765/ 使用“真实微信 · 只读监听测试”。已建立文件传输助手基线，正在等待用户手机发送合成测试文字。真实新消息验收仍pending。

### 真实新消息验收结果

2026-10-31 16:28（Asia/Shanghai）：用户用手机向文件传输助手发送约定合成测试文字，后台只读监听实际收到。消息ID、发送者ID、原始时间戳均存在，isSelf=true符合同账号手机发送行为。证据为data/wechat/live-inbound-report.json，不保存测试外的聊天正文。

本项仅标记“文件传输助手新增普通文本接收 verified”；好友他人入站、普通群多成员入站、真实@、引用、掉线/重启重连和微信发送仍pending。原data/wechat/schema-report.json及mapping-report.json为数据库结构证据，不能替代这些流程验收。
