# 发送端可访问性实测（2026-10-31）

用户明确授权临时开启Windows辅助功能标志，并由用户手动重启微信。执行前备份RunningState与SPI_GETSCREENREADER，开启后和手动重启后分别读取UIA节点，不读取聊天内容。

两轮结果均为微信4.2.0.12，主窗口Qt51514QWindowIcon，仅两个Pane子节点、无第二层节点，没有发送输入或按钮。证据data/wechat/uia-after-accessibility.json与uia-after-restart.json。因此不把wx4py连接成功日志当作真实发送能力。

本轮临时系统辅助功能标志已使用scripts/wechat-accessibility.ps1 -Action Restore恢复到备份状态。未修改微信进程、数据库、登录信息；未发送测试或其他消息。只读接收模块保留。

恢复后下一步需要用户明确选择：允许程序化键盘/OCR桌面发送（不用computer-use工具，但属于桌面自动化），或另行指定经验证的非桌面发送接口。不默认采用进程注入。当前发送端仍未通过，不启用真实自动回复。
