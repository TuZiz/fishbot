# FishBot

TypeScript / Node.js 微信 AI 聊天机器人。接收、模型、记忆、群聊决策、持久化队列与原生后端解耦，提供 MockAdapter 和 Web 管理后台。

## 已验证的软件版本

| 组件 | 当前部署实测版本 |
| --- | --- |
| 微信 Windows x64 | **4.1.15.56**，同时匹配 DLL 指纹 |
| 操作系统 | **Windows Server 2025 Datacenter Evaluation**，10.0.26100 x64 |
| Node.js / 内置 SQLite | **22.23.4 / 3.53.4** |
| Python / Frida | **3.13.15 / 17.25.0** |
| FFmpeg | **7.1 essentials build** |
| TypeScript / tsx | **5.9.3 / 4.23.15** |

当前 `Weixin.dll` SHA256：`e0428a7b691853de496532523c2c09aa095f90941c37c9f4cfb3f137f3c66556`。

完整版本与验收范围见[兼容性](docs/compatibility.md)、[机器清单](config/verified-runtime.json)。以上是2026-11-01已运行基线，不代表任意旧微信自动兼容或已经通过长期稳定性验收。当前云端支持无需打开对应聊天窗口的文字发送。

## 功能

- 私聊独立上下文、消息合并；群聊由AI判断是否参与，保留成员、@和引用结构。
- DeepSeek模型/参数、超时/重试/限流、用量统计；人格和设置可从后台修改。
- 会话上下文、摘要和人物记忆按会话隔离，支持管理与清理。
- SQLite WAL、消息去重、持久队列、回执核验、unknown不自动重发。
- 引用照片改图：先确认等待提示sent，缓存缺失只下载当前引用照片，核验身份/MD5/格式后付费编辑。
- [改图指令](docs/image-intents.md)：局部换色、增删物体、调光、风格和图中文字编辑，支持句首/句尾@；不属于OCR。
- 图片单任务、60秒付费冷却、同指令/原图5分钟去重。表情缺素材会降级，仓库不附真实表情资源。
- Web管理、全局暂停、健康、终端日志、守护恢复和Windows登录启动脚本。

## 本地 Mock 开始

要求Node.js 22.13+，推荐上表基线。使用锁文件安装：

```powershell
npm ci
Copy-Item .env.example .env
# 本机填写至少24字符的随机管理令牌及按需API密钥。
npm run typecheck
npm test
npm run build
npm start
```

管理台 `http://127.0.0.1:8765/`，健康 `/health`；后台API需要管理令牌。默认 `ADAPTER=mock`、`DRY_RUN=true`，测试会话由 `TEST_SCOPES` 或后台设置决定。

[部署说明](docs/deployment.md)区分Mock、只读接收和原生云端模式。仓库不含个人环境文件、密钥、账号profile或第三方二进制。真实微信需要已登录的授权环境和本机核验的profile，新克隆不能直接接管任意账号。

## 验证与开发

当前105项自动化测试、TypeScript检查及构建通过；80种肯定改图表达和33种负例有回归。新版分类的真人微信付费回图仍需新请求验收，不回放历史任务。客户端重启、锁屏/RDP断开、中途取消和长稳尚未全部验收。

开发入口：[DEVELOPMENT](DEVELOPMENT.md)、[AI交接](docs/AI_HANDOFF.md)、[进度](docs/progress.md)。`legacy/`仅供参考。
