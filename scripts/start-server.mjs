import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(root, '.env');
const supervisor = resolve(root, 'scripts', 'supervisor.mjs');
if (!existsSync(envFile)) throw new Error(`Missing ${envFile}`);
if (!existsSync(supervisor)) throw new Error(`Missing ${supervisor}`);
const token = process.env.INGEST_TOKEN ?? '';
if (token.length < 24) throw new Error('INGEST_TOKEN must be at least 24 characters');

const execFileAsync = promisify(execFile);
const port = Number(process.env.PORT || 8765);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid PORT: ${process.env.PORT}`);
const portBusy = await new Promise(resolvePort => {
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolvePort(true); });
  socket.once('error', () => resolvePort(false));
});
console.log('[FishBot] 启动检查');
console.log(`[FishBot] Node.js ${process.versions.node} | 目录 ${root}`);
console.log(`[FishBot] 配置端口 ${port} | DRY_RUN=${process.env.DRY_RUN || 'true'} | AI Key=${process.env.DEEPSEEK_API_KEY ? '已配置' : '未配置'}`);
if (portBusy) throw new Error(`端口 ${port} 已被占用，请停止旧实例后重试`);

if (process.platform === 'win32') {
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command',
      "$p=Get-Process -Name Weixin -ErrorAction SilentlyContinue|Select-Object -First 1; if($p){$v=(Get-Item $p.Path).VersionInfo.ProductVersion;$p.Path+'|'+$v}else{'NOT_RUNNING'}"], { windowsHide: true });
    const [wechatPath, wechatVersion] = stdout.trim().split('|');
    if (wechatPath === 'NOT_RUNNING') console.log('[FishBot] 微信进程：未发现，Mock/AI 模式仍可启动');
    else if (wechatVersion === '4.1.15.56') console.log(process.env.FISHBOT_CLOUD_ALL==='true'?(process.env.FISHBOT_WINDOWLESS==='true'?`[FishBot] 微信 ${wechatVersion}：全量后台原生入口，无白名单；无需打开对应聊天窗口，等待运行时握手`:`[FishBot] 微信 ${wechatVersion}：全量原生入口；无白名单，发送仍需有效聊天窗口上下文`):`[FishBot] 微信 ${wechatVersion}：旧版兼容模式，允许只读/Mock；原生发送需单独验证`);
    else console.log(`[FishBot] 微信 ${wechatVersion || '版本未知'}：已发现 ${wechatPath || ''}`);
  } catch { console.log('[FishBot] 微信版本检查：未完成，不影响 Mock/AI 启动'); }
}
console.log('[FishBot] 正在启动守护进程...');

const child = spawn(process.execPath, [supervisor], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: false,
});
child.once('error', error => {
  console.error(`[FishBot] supervisor spawn failed: ${error.message}`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
console.log(`[FishBot] 管理台：http://127.0.0.1:${port}/`);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}
