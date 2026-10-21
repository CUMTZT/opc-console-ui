import { defineConfig } from '@playwright/test';
const port = Number(process.env.UI_TEST_PORT || 15174);
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  use: {
    baseURL: process.env.UI_TEST_URL || `http://127.0.0.1:${port}`,
    headless: true,
  },
  webServer: process.env.UI_TEST_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${port}`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
      },
});
