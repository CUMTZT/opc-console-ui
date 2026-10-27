/**
 * 自动连接回归：无需令牌、故障后自动恢复。
 * 在浏览器请求层检查行为，避免只验证按钮文案而漏掉实际鉴权头。
 */
import { test, expect } from '@playwright/test';
import { mockAPIs, openGateway } from './fixtures.js';

// 免令牌连接：页面打开及浏览器重载不要求输入凭据，也不发送 Authorization。
test('gateway opens and reloads without credentials or authorization headers', async ({
  page,
}) => {
  await mockAPIs(page);
  const requests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/gateway/'))
      requests.push(request);
  });
  await openGateway(page, 'nodes');
  await expect(page.getByText('设备节点 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('管理令牌', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '退出连接', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('设备节点 1', { exact: true })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests)
    expect(request.headers().authorization).toBeUndefined();
});

// 初始化恢复：首次不可用之后自动重试并连接，仍无需额外凭据。
test('gateway bootstrap can recover from an unavailable service without credentials', async ({
  page,
}) => {
  await mockAPIs(page);
  await page.route('**/api/gateway/capabilities', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 503, message: 'temporary service failure' }),
    }),
  );
  await openGateway(page, 'nodes');
  await expect(page.getByRole('alert')).toContainText(
    'temporary service failure',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '写入', exact: true }),
  ).toHaveCount(0);
  await page.unroute('**/api/gateway/capabilities');
  await page.getByRole('button', { name: '刷新状态', exact: true }).click();
  await expect(page.getByText('设备节点 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
