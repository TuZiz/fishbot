# Windows 部署

先核对[已验证版本](compatibility.md)。当前实际系统是Windows Server 2025；2019/2022仍为未实测目标。推荐Node 22.23.4；真实微信必须4.1.15.56 x64且DLL指纹匹配。

## Mock / AI

1. npm ci，复制.env.example为.env，在本机填写随机管理令牌和按需API密钥；默认DRY_RUN=true。
2. npm run typecheck、npm test、npm run build，npm start启动。
3. 管理台为127.0.0.1:8765/，健康/health，后台API需要管理令牌。保持管理服务仅本机监听。
4. Windows守护可运行node scripts/start-server.mjs，或用start-server.ps1传入-NodePath。bat/ps1在项目或上级tools/node/node.exe寻找Node，不默认回退到PATH。

## 微信只读接收

设置ADAPTER=wechat-database、WECHAT_STORAGE_PATH、WECHAT_DB_KEY_FILE。此Adapter只接收，发送返回not-sent，不是原生自动回复。只读快照在临时副本解密，不修改微信原DB或登录信息。密钥由授权用户本机提供，不由程序提取。

## 已验证的原生入口

scripts/run-cloud-all.mjs依赖既有私有runtime和C:/wx布局，不是一键适配任意账号：

- 项目C:/wx/fishbot，Node在C:/wx/tools/node/node.exe。
- 原生runtime在C:/wx/tools/fishbot-frida-research-17.25.0，脚本列表见根DEVELOPMENT.md。
- runner中Python和FFmpeg路径固定，迁移前检查源码中的路径并单独核验。
- 需要已登录的授权微信、私有cloud-profile.json、当前进程/线程/布局核验和匹配DLL指纹。
- .env配置数据库目录/密钥路径、API、端口及稳定NATIVE_DB_PATH。
- 核验后显式设置FISHBOT_CLOUD_ALL=true、FISHBOT_WINDOWLESS=true，按已验能力开启WECHAT_NATIVE_IMAGES。新部署先保持DRY_RUN=true。

supervisor按FISHBOT_CLOUD_ALL选择入口。全量runner按真实会话目录设置全部好友/群，无需白名单，群AI仍判断是否参与。新会话目录、微信重启等边界需独立验收。

GitHub不含二进制、账号profile、密钥或数据库，新克隆不能直接开启真人收发。相同版本号仍需核对DLL指纹；其他版本不自动兼容。

## 维护与恢复

supervisor按日转发/保存日志、保留30天，每15秒检查健康；持续失败尝试IPC优雅停止并退避重启。data/STOP是紧急停止标记，恢复前确认并移除。TERMINAL_MESSAGE_CONTENT=false可隐藏终端正文。

健康ok只证明应用存活；还要看connected、nativeReady、paused、dryRun和quotedDownloadsSupported。DB回执不等于远端已阅读；不重放历史unknown或付费请求。

可显式执行install-startup.ps1注册当前用户登录启动任务，不是Session 0微信服务。锁屏、RDP断开、无人登录、微信重启没有完整验收。维护先暂停和优雅停止，备份.env及含WAL的SQLite完整快照，不能运行中只复制主DB。
