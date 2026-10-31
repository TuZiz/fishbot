# FishBot

大肥鱼 AI 聊天机器人，TypeScript + Node.js 22.13+，DeepSeek API、SQLite WAL、可替换微信 Adapter、本地 Web 管理台。

当前提供完整的 Mock 聊天链路。Windows 微信 4.2.0.12 已在本机“备忘录”通过真实数据库接收 → DeepSeek → 持久化队列 → 原生文本发送闭环，连续两轮回复获得独立数据库回读确认。通用好友、普通群、图片发送与长期重连尚未验收，不能当作完整微信后端上线。

## 启动

```powershell
npm ci
Copy-Item .env.example .env
# 在本机编辑 .env：设置随机 INGEST_TOKEN（至少24字符）和 DEEPSEEK_API_KEY
npm run build
npm start
```

本次下载并校验过的 Node 位于 `D:\mypluins\wx\.tools\node-v22.23.4-win-x64`，如系统 PATH 没有 Node，先把该目录加入当前 PowerShell 的 `$env:Path`。生产机请安装 Node.js 22.13+。

打开 http://127.0.0.1:8765/ ，输入本机 .env 中的 INGEST_TOKEN。后台支持群聊/私聊开关、暂停、白名单、人格与模型参数热更新、每群活跃度、记忆管理、素材登记、模拟多人对话、回复队列和用量错误查看。令牌只保留在页面内存，不写浏览器存储。

普通入口 `npm start` 默认 DRY_RUN=true；AI 仍会调用并可能计费，回复记录为 dry-run，不调用发送方法。普通入口的 DRY_RUN=false 也只使用 MockAdapter；真实备忘录发送必须另行启动下述实验入口。更改环境变量需要重启；管理台运行配置保存在 SQLite，立即生效。TEST_SCOPES 只在首次创建配置时作为白名单种子，之后通过后台管理。

## 本机备忘录原生自动回复实验

本机已完成两次真实 AI 自动发送。测试消息由已授权的 Computer Use 技能输入；AI 回复的生成和发送没有键盘、OCR 或桌面操作，由原生后端自动完成。仅适用于本机已确认指纹的 4.2.0.12，且微信需要保持可用 UI 消息线程。

```powershell
# 先 npm run build；只在本机现有数据库密钥、路径和原生研究配置齐备时运行
$env:FISHBOT_PYTHON = 'C:\Users\32633\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
node scripts/run-native-memo.mjs --enable-native-memo-test --live-send
```

打开 http://127.0.0.1:8766/ 使用原有管理令牌。先在微信“备忘录”发送 `FishBot_CONNECT_1031`；`/health` 中 adapter.connected=true 后，发送 `鱼测试：今天想吃什么？`。程序只将这个前缀的备忘录消息作为自测输入；普通消息与其他会话不会进入 AI。生成回复自动进入队列，数据库出现正文相同、ID 非零的新消息才记为 sent；状态 unknown 禁止自动重发。Ctrl+C 优雅停止并卸载临时 Hook。

实验默认仍为 DRY_RUN，只有显式 `--live-send` 才实发。使用独立 `data/native-memo-test.sqlite`，关闭群聊、长期记忆和图片；重启取消上轮 pending 任务，保留历史 sent/unknown 供核对。当前依赖一次预热获得会话对象，租期仅5分钟，超时必须再次预热；重启微信后需要更新本机进程元信息。不保证切换会话、客户端重启或无人值守长期可用。准确指纹、准备条件与证据见 [原生实验说明](native/research/README.md)。

## 聊天流程

- 私聊按会话合并连续消息，读取最近30条消息及近期机器人回复；不同私聊和群聊范围严格分离。
- 群聊先由 AI 返回参与决策（含原因、对象、类型、置信度、话题），再生成回复。@和引用绕过普通冷却，但不绕过暂停或每分钟上限。AI 根据上下文和活跃度判断，不使用随机回复概率。
- 同群串行处理，新消息到达会取消旧生成、待发旧回复；模型忽略取消信号时仍用版本检查丢弃结果。话题超时、配置改变、关闭会话时也取消。重复的完整回复被抑制，语义重复通过提示词约束，不保证完全消除。
- 直接发送“停止回复”“别回复了”“暂停回复”“闭嘴”暂停当前会话；“恢复回复”“继续回复”恢复。暂停状态持久化。全局暂停通过后台控制。
- 所有回复进入持久化发送队列。明确 not-sent 时最多尝试3次、指数退避；异常/超时/重启遗留 sending 变为 unknown，不自动重发。待发回复60秒后过期。

## 记忆与素材

长期记忆按 `[private|group, 会话ID]` + 成员ID + 类型隔离，含来源消息ID、更新时间。类型为称呼、兴趣、约定、习惯、关系。每逢当前会话入站计数为10的倍数且该批次完成回复时，模型提取带逐字来源的事实并生成滚动摘要。不会跨群或跨私聊读取。自动提取依赖模型判断，后台可修正。

敏感词/长数字/邮箱规则过滤原始持久化文本和自动事实；这是保守启发式，不能保证识别所有敏感信息。默认保留30天，支持配置，定期清理消息正文、记忆、摘要、历史回复正文和统计日志；去重 ID 保留以防重放。删除记忆会阻止该会话继续自动提取，避免被历史内容重新创建；仍可手动添加。

素材目录 `assets/expressions/` 默认没有大肥鱼图片，不宣称已有资源。将获准使用的 PNG/JPG/GIF/WebP 放入该目录，在后台登记 ID、相对路径、情绪标签。AI 只能选择目录ID；缺失文件、越界路径或冷却中自动回退纯文字。每条模型回复必须有文字备用。图片与文字分别记录发送结果，可能部分成功。

## 验证与部署

```powershell
npm run typecheck
npm test
npm run build
node scripts/smoke-production.mjs
powershell -File scripts/probe-environment.ps1
powershell -File scripts/healthcheck.ps1
```

Windows Server 2019/2022 部署步骤见 [部署说明](docs/deployment.md)。接入限制见 [4.2评估](docs/wechat-4.2-assessment.md)。原版保存在 legacy/，不参与构建和测试。

API：公开 `/health` 和管理台静态资源；其余路径必须携带 `x-fishbot-token`。`POST /ingest` 的字段为 id、kind（private/group）、conversationId、senderId、text、timestamp（毫秒），可选 senderName、mentionedBot、replyToBot、isSelf。`GET /replies` 查看状态；`POST /probe/send` 接受 `{message, text}` 作显式模拟发送；`POST /control` 接受 `{paused}`。`/api/settings` 读写完整运行配置；`/api/memory`、`/api/expressions` 管理资源；`/api/status` 查看统计；`/api/session` 接受 `{scope,paused}` 手动暂停会话。

本地只监听127.0.0.1，不提供外网托管。Node 22 的 node:sqlite 有实验性提示，当前小事务是同步执行，未做大规模压力测试；不应宣称已达到无人值守长期生产验收。

配置好密钥后可执行 `node scripts/probe-deepseek.mjs` 进行少量付费真实API验证；开发进度见 docs/progress.md。

普通后台的“真实微信只读监听测试”仍只观察文本，不转交AI或发送；只有独立备忘录实验入口接入 AI 和原生发送。证据与限制见 docs/database-hook-assessment.md。
