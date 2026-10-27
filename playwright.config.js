/**
 * Playwright 在真实浏览器中测试 React 页面交互，普通测试由 fixtures 拦截 API。
 * 默认单独启动 15174 端口的 Vite，拒绝复用未知服务，避免干扰正在使用的开发环境。
 * UI_TEST_URL 显式指定外部前端时不再启动服务；真实后端用例还各有独立的启用开关。
 */
import { defineConfig } from '@playwright/test';
const port = Number(process.env.UI_TEST_PORT || 15174);
export default defineConfig({
  // 只从 tests 目录收集用例；普通用例会先 mockAPIs 拦截网络，live 用例另有启用开关。
  testDir: './tests',
  // 不强制同文件各用例完全并行；不同测试文件仍可由多个 worker 同时运行。
  fullyParallel: false,
  use: {
    baseURL: process.env.UI_TEST_URL || `http://127.0.0.1:${port}`,
    headless: true,
  },
  // 显式给 UI_TEST_URL 时由调用方管理前端服务，否则 Playwright 自启自停独立 Vite。
  webServer: process.env.UI_TEST_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${port}`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
      },
});
