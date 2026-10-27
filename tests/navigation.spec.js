/**
 * 导航与状态保留回归：分组路由、旧书签和模拟草稿跨页面切换。
 * 理解 App 中隐藏与卸载的区别时，可对照这组用例阅读。
 */
import { test, expect } from '@playwright/test';
import { mockAPIs, navigateTo } from './fixtures.js';

// 内部导航：模拟服务三个子页分离，但来回切换不会重新创建未保存配置草稿。
test('grouped navigation separates simulator pages and preserves the configuration draft', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: '主导航' });
  const simulator = nav.getByRole('region', { name: '模拟服务', exact: true });
  const gateway = nav.getByRole('region', { name: '采集网关', exact: true });
  await expect(
    page.getByRole('heading', { name: '系统总览', exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole('link', { name: '系统总览', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(simulator.getByRole('link')).toHaveText([
    '运行总览',
    '模拟配置',
    '数据监控',
    '运行日志',
  ]);
  await expect(gateway.getByRole('link')).toHaveText([
    '运行总览',
    '节点监控',
    '连接配置',
    '网关设置',
    '运行日志',
  ]);

  await simulator.getByRole('link', { name: '运行总览', exact: true }).click();
  await expect(page).toHaveURL(/#server\/overview$/);
  await expect(
    page.getByRole('heading', { name: '模拟服务总览', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '节点类型分布' }),
  ).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.getByRole('button', { name: '配置模拟', exact: true }).click();
  await expect(page).toHaveURL(/#server\/configuration$/);
  const editor = page.getByRole('form', { name: '模拟服务配置' });
  await editor.getByLabel('刷新间隔（毫秒）', { exact: true }).fill('200');
  await expect(page.getByText('有未保存的修改', { exact: true })).toBeVisible();
  await expect(
    page.getByLabel('搜索节点名称或 NodeId', { exact: true }),
  ).toHaveCount(0);

  await simulator.getByRole('link', { name: '数据监控', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '数据监控', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: '出口温度', exact: true }),
  ).toBeVisible();
  await page.getByLabel('搜索节点名称或 NodeId').fill('出口温度');
  await nav.getByRole('link', { name: '系统总览', exact: true }).click();
  await simulator.getByRole('link', { name: '模拟配置', exact: true }).click();
  await expect(
    editor.getByLabel('刷新间隔（毫秒）', { exact: true }),
  ).toHaveValue('200');
  expect(state.simulation.config.tickMs).toBe(100);
  await editor.getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect.poll(() => state.simulation.config.tickMs).toBe(200);
  await expect(page.getByText('配置已同步', { exact: true })).toBeVisible();
  await simulator.getByRole('link', { name: '数据监控', exact: true }).click();
  await expect(page.getByLabel('搜索节点名称或 NodeId')).toHaveValue(
    '出口温度',
  );
  await expect(
    simulator.getByRole('link', { name: '数据监控', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
});

// 地址兼容：完整子路由可直达，旧 #server 书签继续进入节点监控。
test('simulator pages support direct links and the original server bookmark', async ({
  page,
}) => {
  await mockAPIs(page);
  for (const [path, title] of [
    ['server/configuration', '配置'],
    ['server/overview', '模拟服务总览'],
    ['server/monitor', '数据监控'],
    ['server', '数据监控'],
  ]) {
    await page.goto('/#' + path);
    await expect(
      page.getByRole('heading', { name: title, exact: true, level: 1 }),
    ).toBeVisible();
    if (path === 'server/configuration') {
      await expect(
        page
          .getByRole('form', { name: '模拟服务配置' })
          .getByLabel('刷新间隔（毫秒）', { exact: true }),
      ).toHaveValue('100');
    }
  }
});

// 手机导航：分组侧栏可以打开和关闭，模拟服务各页均适配视口。
test('grouped navigation and all simulator pages fit a mobile viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAPIs(page);
  await page.goto('/');
  const simulator = page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('region', { name: '模拟服务', exact: true });
  for (const [link, title] of [
    ['运行总览', '模拟服务总览'],
    ['模拟配置', '配置'],
    ['数据监控', '数据监控'],
  ]) {
    await navigateTo(page, link, '模拟服务');
    await expect(
      page.getByRole('heading', { name: title, level: 1, exact: true }),
    ).toBeVisible();
    if (link === '模拟配置')
      await expect(
        page.getByLabel('刷新间隔（毫秒）', { exact: true }),
      ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
