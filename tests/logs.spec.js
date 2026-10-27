/**
 * 日志浏览回归：独立筛选、分页锚点、重启、暂停刷新与移动布局。
 * 用例直接操控夹具中的日志集合，模拟持续新增日志而无需运行真实服务。
 */
import { test, expect } from '@playwright/test';
import { mockAPIs, navigateTo } from './fixtures.js';

// 按服务类型定位日志表格区域，验证无障碍区域命名与表格内容归属。
const region = (page, service) =>
  page.getByRole('region', {
    name: `${service === 'gateway' ? '采集网关' : '模拟服务'}日志数据表`,
    exact: true,
  });

// 日志复用：两个服务分别查询和保留自己的筛选，不要求凭据。
test('both services expose independent searchable logs without credentials', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  state.logs.server.at(-1).message = '<script>window.logInjected=true</script>';
  await page.goto('/#server/logs');
  await expect(region(page, 'server').getByRole('row')).toHaveCount(51);
  await expect(
    region(page, 'server').getByText(
      '<script>window.logInjected=true</script>',
      { exact: true },
    ),
  ).toBeVisible();
  expect(await page.evaluate(() => window.logInjected)).toBeUndefined();
  await page.getByLabel('日志级别', { exact: true }).selectOption('WARN');
  await expect.poll(() => state.logRequests.at(-1)?.level).toBe('WARN');
  await expect(
    region(page, 'server').getByRole('cell', { name: 'ERROR', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('搜索日志', { exact: true }).fill('operation-18');
  await expect(region(page, 'server').getByRole('row')).toHaveCount(2);
  await region(page, 'server')
    .getByRole('button', { name: '详情', exact: true })
    .click();
  const detail = page.getByRole('dialog', { name: '日志详情' });
  await expect(detail.getByText('operation-18', { exact: true })).toBeVisible();
  await expect(detail.getByText('[REDACTED]', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await navigateTo(page, '运行日志', '采集网关');
  await expect(region(page, 'gateway').getByRole('row')).toHaveCount(51);
  await page.getByLabel('日志机组', { exact: true }).selectOption('machine-2');
  await expect.poll(() => state.logRequests.at(-1)?.machine).toBe('machine-2');
  await expect(
    region(page, 'gateway').getByText('machine-1', { exact: true }),
  ).toHaveCount(0);
  await navigateTo(page, '运行日志', '模拟服务');
  await expect(page.getByLabel('搜索日志', { exact: true })).toHaveValue(
    'operation-18',
  );
  await expect(page.getByLabel('日志级别', { exact: true })).toHaveValue(
    'WARN',
  );
});

// 稳定翻页：新日志追加不移动历史窗口；进程重启后旧游标被正确放弃。
test('history pagination stays anchored while new logs arrive and recovers after restart', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  await page.goto('/#server/logs');
  await expect(
    region(page, 'server').getByText('server log 125 运行记录', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: '自动刷新', exact: true }).uncheck();
  await expect(page.getByText('自动刷新已暂停', { exact: true })).toBeVisible();
  state.logs.server.push({
    ...state.logs.server.at(-1),
    id: 126,
    message: 'newly appended log',
  });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(
    region(page, 'server').getByText('server log 75 运行记录', { exact: true }),
  ).toBeVisible();
  expect(state.logRequests.at(-1).anchor).toBe('125');
  await expect(
    region(page, 'server').getByText('newly appended log', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('浏览历史页时暂停自动刷新', { exact: false }),
  ).toBeVisible();
  state.logInstances.server = 'server-restarted';
  state.logs.server = [
    {
      ...state.logs.server[0],
      id: 1,
      message: 'service restarted successfully',
    },
  ];
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(
    page.getByText('服务已重新启动，已返回最新日志。', { exact: true }),
  ).toBeVisible();
  await expect(
    region(page, 'server').getByText('service restarted successfully', {
      exact: true,
    }),
  ).toBeVisible();
});

// 筛选边界：空结果、无效时间范围与后端错误恢复均有明确状态。
test('filters support empty results, custom-time validation and error recovery', async ({
  page,
}) => {
  await mockAPIs(page);
  await page.goto('/#gateway/logs');
  await expect(region(page, 'gateway').getByRole('row')).toHaveCount(51);
  await page.getByLabel('搜索日志', { exact: true }).fill('unmatched-keyword');
  await expect(
    page.getByText('当前筛选条件下没有日志。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(region(page, 'gateway').getByRole('row')).toHaveCount(51);
  await page.getByLabel('日志时间范围', { exact: true }).selectOption('custom');
  await page.getByLabel('开始时间', { exact: true }).fill('2026-10-22T10:00');
  await page.getByLabel('结束时间', { exact: true }).fill('2026-10-21T10:00');
  await expect(page.getByRole('alert')).toContainText(
    '开始时间不能晚于结束时间',
  );
  await expect(
    page.getByRole('button', { name: '刷新日志', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(region(page, 'gateway').getByRole('row')).toHaveCount(51);
  await page.route('**/api/gateway/logs?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'temporary logs failure' }),
    }),
  );
  await page.getByRole('button', { name: '刷新日志', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('temporary logs failure');
  await expect(region(page, 'gateway').getByRole('row')).toHaveCount(51);
  await page.unroute('**/api/gateway/logs?**');
  await page.getByRole('button', { name: '刷新日志', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// 日志小屏：过滤器和服务导航能在手机视口中正常使用。
test('log filters and service navigation fit a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAPIs(page);
  await page.goto('/#server/logs');
  await expect(region(page, 'server').getByRole('row')).toHaveCount(51);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await navigateTo(page, '运行日志', '采集网关');
  await expect(page.getByLabel('日志机组', { exact: true })).toBeVisible();
  await page.getByLabel('日志时间范围', { exact: true }).selectOption('custom');
  await expect(page.getByLabel('开始时间', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

// 暂停策略：停止自动查询后，手动刷新仍能主动请求一次。
test('pausing freezes automatic polling while manual refresh remains available', async ({
  page,
}) => {
  await page.clock.install();
  const state = await mockAPIs(page);
  await page.goto('/#server/logs');
  await expect(region(page, 'server').getByRole('row')).toHaveCount(51);
  await page.getByRole('checkbox', { name: '自动刷新', exact: true }).uncheck();
  await expect(page.getByText('自动刷新已暂停', { exact: true })).toBeVisible();
  const count = state.logRequests.length;
  await page.clock.runFor(2500);
  expect(state.logRequests).toHaveLength(count);
  await page.getByRole('button', { name: '刷新日志', exact: true }).click();
  await expect.poll(() => state.logRequests.length).toBeGreaterThan(count);
});
