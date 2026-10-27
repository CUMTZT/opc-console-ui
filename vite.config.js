/**
 * Vite 运行在 Node.js 中，负责开发服务、JSX 转换、热更新和构建，不是浏览器组件。
 * SERVER_API_TARGET / GATEWAY_API_TARGET 只供代理选上游，不打进客户端代码。
 */
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// defineConfig 接受函数，Vite 按当前 mode 求值；不是 React 渲染，也不能在这里调用 Hooks。
export default defineConfig(({ mode }) => {
  // 根据 dev/build 模式加载环境文件，保持同一套浏览器代码可部署到不同后端地址。
  const env = loadEnv(mode, process.cwd(), '');
  // 将两组 [前缀, 上游] 转成代理对象，两种服务共用同一套转发选项，避免策略漂移。
  const proxy = Object.fromEntries(
    [
      ['/api/server', env.SERVER_API_TARGET || 'http://127.0.0.1:8080'],
      ['/api/gateway', env.GATEWAY_API_TARGET || 'http://127.0.0.1:1234'],
    ].map(([prefix, target]) => [
      prefix,
      {
        target,
        // 保留浏览器的 Host；Origin 与 Sec-Fetch-Site 不在这里重写，供 Go 校验来源。
        changeOrigin: false,
        // 例如 /api/server/nodes 转为上游的 /api/nodes，浏览器仍只访问同源入口。
        rewrite: (path) => '/api' + path.slice(prefix.length),
      },
    ]),
  );
  return {
    // 插件为开发期组件热更新与 React 源码处理提供支持。
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      // 端口占用时直接失败，不静默换端口，便于代理、测试和用户访问地址保持一致。
      strictPort: true,
      proxy,
      // WSL 的 Windows 挂载盘可能丢失文件事件，针对这种目录启用开发文件轮询。
      // 这里是构建工具监听源码，和 shared.jsx 的接口串行轮询是两回事。
      watch: {
        usePolling:
          process.platform === 'linux' &&
          /^\/mnt\/[a-z]\//i.test(process.cwd()),
        interval: 300,
      },
    },
    // preview 服务于构建产物本地验收，仍需代理；生产托管使用 deploy/nginx.conf 等静态服务。
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  };
});
