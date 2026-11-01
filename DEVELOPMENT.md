# FishBot 开发说明

## 工程与验证

Node.js/TypeScript ESM，Node内置SQLite，依赖由package-lock.json锁定。基线见[兼容性](docs/compatibility.md)。

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

当前105项测试通过。发布检查实际暂存内容，不发布凭据、聊天、数据库、缓存、profile和第三方二进制。data/保存私有诊断、精确备份，不入Git。

## 模块

| 路径 | 职责 |
| --- | --- |
| src/core | 装配、交付、生命周期 |
| src/adapters/mock | 模拟收发 |
| src/adapters/wechat/database | 只读快照、临时解密、消息/引用/缓存及下载协调 |
| src/adapters/wechat/native | IPC、恢复、原生Adapter、回执 |
| src/ai / src/group / src/conversation | 模型、群参与、会话合并/取消 |
| src/memory / src/storage | 隔离记忆、SQLite事务/迁移 |
| src/images | 意图、等待提示、图片客户端、格式和限流 |
| src/admin / src/monitoring | 管理、日志、健康和用量 |
| native | 精确版本隔离的原生代码 |

legacy不是运行入口，内部偏移不得进入模型或会话核心。

## 原生运行

scripts/run-cloud-all.mjs由supervisor选择，使用唯一host。runner按C:/wx部署布局编写，迁移检查Python、FFmpeg、runtime及私有profile路径，构建不等于接入验收。

native/research/probe-cloud-native.py也是生产host。runtime需连同context-registry.js、memo-agent.js、windowless-agent.js、cached-image-reader.js、quoted-image-task.js、quoted-image-download.js及指纹文件部署。账号profile、PID/线程及目标须在本机核验，不随源码分发。

实验对象通过私有环境变量FISHBOT_TEST_FRIEND_ID、FISHBOT_TEST_GROUP_ID、FISHBOT_TEST_GROUP_2_ID配置。未设置拒绝对应好友/群探针；文件传输助手范围保持。Python从父进程继承变量或由本机shell设置。这些变量不影响生产全量会话目录。

## 图片契约

明确请求、去重/限流后确认等待sent。核验原会话/消息/作者/type3/MD5，缓存优先，缺失只下载这一张。原图优先，其次普通清晰图，拒绝缩略图；单并发、期限、同引用60秒去重，完成后重新查索引并核验。失败不付费，暂停/新上下文使旧结果失效。

群引用fromusr为当前群时取chatusr，但仍比对原消息作者。严格管理线程和共享所有权，不重放捕获指针、不猜版本偏移。旧高层Hook和RPC直接查询保持隔离，历史见docs/image-download-research.md。

源码测试、原生调用、数据库回执和远端效果确认分开报告。真人文字收发、已缓存照片编辑、缺缓存原图下载已有不同证据；新版意图的真实付费回图、中途取消、重启和长稳仍待专项验收。

旧私人部署笔记备份于被忽略的data/private-release-backup/，公开文档只保留脱敏结论。GitHub整理不更改云端服务、账号或配置。
