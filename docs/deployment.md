# Windows Server 部署

目标系统：Windows Server 2019/2022；本次未在这两种系统实测。当前仅 Mock 接入，不依赖微信桌面。

1. 安装 Node.js 22.13+，将项目放入固定目录，执行 npm ci、npm run build、npm test。
2. 创建 .env，设置本机管理令牌与 DeepSeek 密钥；保持 DRY_RUN=true 先验证。密钥不填写到后台或日志中。
3. 在项目目录执行 node scripts/supervisor.mjs。它启动编译后的 dist/index.js，崩溃指数退避重启（最高60秒），每15秒健康检查，连续3次失败先 IPC 优雅停止，再等待15秒后终止。
4. 执行 powershell -File scripts/install-startup.ps1 注册当前用户登录启动任务。只在显式执行脚本时注册，本次未安装系统任务。默认不是开机前无人登录的 Windows 服务。可传入 -NodePath 指定绝对 node.exe 路径。
5. supervisor 按日保存 stdout/stderr 到 data/logs，保留30天。后台错误和用量另存 SQLite，按运行配置清理。

停止守护：创建 data/STOP 空文件，最多15秒后优雅关闭子进程并停止守护。重新启动前手动移除该文件。卸载自动启动执行 scripts/uninstall-startup.ps1；卸载任务不会自动删除用户数据或立即结束已有进程。

维护时先暂停机器人并停止守护，再备份 .env 和 SQLite 数据。数据库运行期间不能只复制主 sqlite 文件而忽略 WAL。升级前留备份，执行构建与测试后再启动；数据库迁移事务化、可重复执行，并拒绝高于当前支持版本的数据库。不要同时运行多个 FishBot 实例指向同一数据库。

健康接口 /health 区分 adapter、dryRun、aiConfigured、paused、realWechatVerified。存活不等于模型或微信可用；只有真实回复验证后才能确认外部依赖可用。没有密钥时入站仍可接收，AI 错误记录在后台，不伪造回复。

如果未来接入依赖 UIA 的后端，还需要登录的交互桌面，必须额外验证锁屏、RDP断开与微信重启；本项目当前不承诺 Session 0 服务模式下微信可用。不要修改现有登录信息以适配部署。
