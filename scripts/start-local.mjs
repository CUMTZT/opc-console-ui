/**
 * Node.js 联合启动器：先检查本地文件、Go 二进制、配置及端口，再启动三个子进程。
 * --check 只预检；实际启动保留网关文件中的设备/Kafka 地址，不会自行启动 Kafka。
 * React 学习时可先读 src；本文件属于本地工程工具，不会进入浏览器构建产物。
 */
import { spawn, execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
// 用脚本自身位置定位工程，避免从不同目录运行时相对路径失效。
const ui = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(ui, '..');
const serverRoot =
  process.env.OPC_SERVER_ROOT || join(workspace, 'opc-server-go');
const gatewayRoot =
  process.env.OPC_GATEWAY_ROOT || join(workspace, 'opc-gateway-go');
const platform = { win32: 'windows', linux: 'linux', darwin: 'darwin' }[
  process.platform
];
const arch = process.arch === 'x64' ? 'amd64' : process.arch;
// Node 与 Go 的系统/架构命名不完全一致，组装与发行包目录一致的二进制路径。
const suffix = process.platform === 'win32' ? '.exe' : '';
const serverBinary =
  process.env.OPC_SERVER_BINARY ||
  join(serverRoot, 'dist', `${platform}-${arch}`, `opc-server-go${suffix}`);
const gatewayBinary =
  process.env.OPC_GATEWAY_BINARY ||
  join(gatewayRoot, 'build', 'go', `opc-gateway${suffix}`);
let configPath = process.env.GATEWAY_CONFIG;
if (!configPath) {
  const normal = join(gatewayRoot, 'config', 'config.toml');
  configPath = await access(normal).then(
    () => normal,
    () => join(gatewayRoot, 'config', 'config.example.toml'),
  );
}
configPath = resolve(configPath);
const dataPath =
  process.env.OPC_SERVER_DATA || join(serverRoot, 'data', 'data.csv');
const serverPort = Number(process.env.OPC_SERVER_PORT || 4840);
const serverHTTP = Number(process.env.OPC_SERVER_HTTP_PORT || 8080);
const uiPort = Number(process.env.OPC_UI_PORT || 5173);

// 这里只摘取 HTTP 监听字段用于代理和端口检查，完整 TOML 的合法性由 Go CLI 验证。
const text = await readFile(configPath, 'utf8');
let section = '',
  gatewayHTTP = 1234,
  gatewayHost = '127.0.0.1';
for (const line of text.split(/\r?\n/)) {
  const heading = line.match(/^\s*\[([^\]]+)\]/);
  if (heading) section = heading[1];
  if (section !== 'opc') continue;
  const port = line.match(/^\s*http_port\s*=\s*(\d+)/);
  const host = line.match(/^\s*http_bind_address\s*=\s*['"]([^'"]+)['"]/);
  if (port) gatewayHTTP = Number(port[1]);
  if (host) gatewayHost = host[1];
}
function urlHost(host) {
  // IPv6 地址嵌入 URL 时必须带方括号。
  return host.includes(':') ? `[${host}]` : host;
}
const gatewayTargetHost =
  // 0.0.0.0/:: 是监听全部网卡的地址；本机代理连接改用对应的回环地址。
  gatewayHost === '0.0.0.0'
    ? '127.0.0.1'
    : gatewayHost === '::'
      ? '::1'
      : gatewayHost;
const endpoints = [serverPort, serverHTTP, gatewayHTTP, uiPort];
if (
  new Set(endpoints).size !== endpoints.length ||
  endpoints.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
)
  throw new Error('服务端口无效或互相冲突');
await access(
  serverBinary,
  process.platform === 'win32' ? constants.F_OK : constants.X_OK,
);
await access(
  gatewayBinary,
  process.platform === 'win32' ? constants.F_OK : constants.X_OK,
);
await run(serverBinary, [
  '--check-data',
  '--data',
  dataPath,
  '--hostname',
  '127.0.0.1',
  '--port',
  String(serverPort),
  '--web',
  `127.0.0.1:${serverHTTP}`,
]);
await run(gatewayBinary, ['--check-config', '--config', configPath]);
// 通过临时监听确认端口可用，结束就关闭；不会查杀占用端口的外部进程。
for (const [port, host] of [
  [serverPort, '127.0.0.1'],
  [serverHTTP, '127.0.0.1'],
  [gatewayHTTP, gatewayTargetHost],
  [uiPort, '127.0.0.1'],
]) {
  await new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once('error', () =>
      reject(
        new Error(
          `${host}:${port} 已占用或不能监听；请停止旧服务或调整配置，本脚本不会终止现有进程。`,
        ),
      ),
    );
    listener.listen(port, host, () => listener.close(resolve));
  });
}
console.log(`配置检查通过：${configPath}`);
console.log(`数据：${dataPath}`);
console.log(
  `前端：http://127.0.0.1:${uiPort}；模拟 API：${serverHTTP}；网关 API：${gatewayHTTP}`,
);
if (process.argv.includes('--check')) process.exit(0);

const children = [];
let stopping = false;
function start(command, args, cwd, env = process.env) {
  // 每个子进程使用自己工程目录，stdio=inherit 把输出直接交给当前终端。
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code || 0);
  });
}
function stop(code) {
  // stopping 防止多个退出事件重复执行；先 SIGINT 给 Go 排空预算，再兜底强制退出。
  // children 只收集本脚本启动的进程，不会扫描和结束无关服务。
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  console.log('正在停止三个服务…');
  for (const child of children)
    if (child.exitCode === null) child.kill('SIGINT');
  const timeout = setTimeout(
    () => {
      for (const child of children)
        if (child.exitCode === null) child.kill('SIGKILL');
    },
    Number(process.env.LOCAL_STOP_TIMEOUT_MS || 45000),
  );
  timeout.unref();
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
async function waitForPort(port, host = '127.0.0.1', timeoutMs = 5000) {
  // 启动阶段短暂等待 TCP 可连接，降低网关过早连接的概率；这不是完整业务健康检查。
  const deadline = Date.now() + timeoutMs;
  while (!stopping && Date.now() < deadline) {
    const ready = await new Promise((resolve) => {
      const socket = createConnection({ port, host });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// 模拟服务先启动，再启动网关和 Vite；上游 HTTP 地址通过环境变量只交给 Vite 代理。
start(
  serverBinary,
  [
    '--hostname',
    '127.0.0.1',
    '--objects',
    '--data',
    dataPath,
    '--port',
    String(serverPort),
    '--web',
    `127.0.0.1:${serverHTTP}`,
  ],
  serverRoot,
);
await waitForPort(serverPort, '127.0.0.1');
if (!stopping) {
  start(gatewayBinary, ['--config', configPath], gatewayRoot);
  start(
    process.execPath,
    [
      join(ui, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port',
      String(uiPort),
    ],
    ui,
    {
      ...process.env,
      SERVER_API_TARGET: `http://127.0.0.1:${serverHTTP}`,
      GATEWAY_API_TARGET: `http://${urlHost(gatewayTargetHost)}:${gatewayHTTP}`,
    },
  );
}
