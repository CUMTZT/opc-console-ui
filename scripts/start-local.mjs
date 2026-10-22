import { spawn, execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
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

// Only these listener settings are read here; the Go CLI validates the complete TOML.
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
  return host.includes(':') ? `[${host}]` : host;
}
const gatewayTargetHost =
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
