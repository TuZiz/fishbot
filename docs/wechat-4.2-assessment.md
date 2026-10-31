# 微信 4.2.0.12 复评（2026-10-31）

> 最新本机结果：经后续授权研究，4.2.0.12备忘录原生文本发送与真实AI自动回复已通过两轮独立数据库回读。仅限精确模块指纹、一次预热和5分钟会话租期；好友、普通群、图片与重连未通过验收。以下为前期接入评估历史，不能当作当前发送器状态。最新证据与运行方式见 ../native/research/README.md 和 ../DEVELOPMENT.md。

本机只读版本检查仍为 E:\Weixin\Weixin.exe 4.2.0.12。没有操作登录、读取凭据、操作窗口或注入进程。真实收发、普通群、稳定群 ID、稳定成员 ID、@、引用、消息 ID/时间戳、断线恢复、重启重连全部 pending。

本轮读取的第一方来源：

- wx4py 仓库：https://github.com/claw-codes/wx4py 。上游声明测试过 4.1.7.59、4.1.8.29，不是 4.2.0.12 的证据。
- wx4py 失败报告：https://github.com/claw-codes/wx4py/issues/19 。4.1.9 已出现窗口隐藏和目标搜索失败；不能以发送函数正常返回认定成功。
- wxauto 官方安装文档：https://docs.wxauto.org/docs/install.html 。免费版列出最高 4.1.8.107；文档虽列 Server 2019/2022 环境，仍不能证明本项目在这些系统通过测试。
- pywechat 上游：https://github.com/Hello-Mr-Crab/pywechat 。其维护方向说明不能替代本机精确版本实测。
- wechatauto-replica：https://github.com/fanyuantaier/wechatauto-replica 。其消息身份和读取能力涉及微信数据库与内存密钥提取路线，与本任务边界不符，本次不安装或执行。

结论：未取得符合当前约束、可验证的 4.2.0.12 接口，真实后端被阻塞。ADAPTER 配置仅接受 mock，不提供假成功占位 Adapter。统一接口保留在 src/adapters/wechat/contract.ts，未来实现替换后必须逐项验证上述能力，并固定库版本及提交号。

Mock 模拟 @、引用、ID 和成员都由调用者提供，不是识别结果。测试报告不得标注微信实测通过。群成员只能拿到展示昵称的后端不能开启本项目群聊功能。
