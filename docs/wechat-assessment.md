# Windows 微信接入评估（2026-10-31）

结论：尚无在本机验证合格的真实微信 Adapter。当前后端只有 Mock。不能把模拟 ID、时间戳、@ 和引用标记当作真实微信字段证据。

wx4py 候选：https://github.com/claw-codes/wx4py 。项目声称使用 Windows UI Automation，README 列出测试版本 4.1.7.59、4.1.8.29；这只是上游声明。本任务不使用 computer-use，也未执行该库的窗口自动化。

反例证据：https://github.com/claw-codes/wx4py/issues/19 。有 4.1.9.55 / 4.1.9.57 的窗口隐藏、UIA 控件减少、找不到搜索框与目标聊天的失败报告，报告末尾仍打印“发送完成”。因此不能把函数返回或日志最后一行当作发送成功；必须独立回读确认目标、内容及结果。

其他候选 pywechat：https://github.com/Hello-Mr-Crab/pywechat 。只作后续源码审查候选，未确认其目标版本能力。注入、数据库解密及账号凭据提取路线不采用。现有 probe/ 的 iLink 脚本不等价于个人好友和普通群接入，本次不执行。

源码审查限制：GitHub tree API 请求返回 rate limit exceeded；未取得精确源码证据，不给任何未知方法编写真实后端调用。后续必须固定提交、核查消息对象与发送回读路径，再进行获准测试对象的人工协同测试。

本机只读检查：运行中 E:\Weixin\Weixin.exe 的文件版本 4.2.0.12，不符合 4.1.x 验证矩阵。不降级、不重启、不改变已有登录。

| 能力 | 本机真实验证 | 验收要求 |
| --- | --- | --- |
| 消息监听 | pending | 多轮新消息事件，不混入历史 |
| 私聊收发 | pending | 测试好友双向回读 |
| 普通群收发 | pending | 测试群双向回读 |
| 群 ID | pending | 改名与重连后稳定且无重名歧义 |
| 群成员身份 | pending | 同名成员、改群昵称后稳定；昵称不能替代 ID |
| @机器人 | pending | 真 @ 与普通文本区分 |
| 引用机器人 | pending | 引用来源可关联原消息 |
| 消息 ID/时间戳 | pending | 原始值来源、重连去重与时间单位验证 |
| 断线检测恢复 | pending | 断网事件和恢复后无漏重发 |
| 微信重启重连 | pending | 人工重启后重新连接，旧监听释放 |

以上全部不能因 Mock 测试通过改为 verified。Windows Server 2019/2022 与锁屏/RDP 断开时的 UIA 行为也未验证。
