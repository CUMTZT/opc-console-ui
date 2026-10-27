/**
 * 工作空间浏览器回归：系统总览链路状态、快捷入口和移动抽屉键盘行为。
 * 页面是否可达、焦点是否可操作和状态是否准确都属于可验证的产品行为。
 */
import { test, expect } from '@playwright/test';
import { mockAPIs, navigateTo } from './fixtures.js';

// 系统总览：链路状态来自响应，快捷入口进入对应实际业务页。
test('workspace overview shows live chain state and working shortcuts', async ({
  page,
}) => {
  await mockAPIs(page);
  await page.goto('/');
  await expect(
    page.getByText('数据链路运行正常', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: '采集数据链路' }).getByRole('listitem'),
  ).toHaveCount(3);
  await expect(page.getByText('machine-1', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /查看实时数据/ }).click();
  await expect(page).toHaveURL(/#server\/monitor$/);
  await expect(
    page.getByRole('region', { name: '模拟节点数据表' }),
  ).toBeVisible();
  await navigateTo(page, '系统总览');
  await page.getByRole('link', { name: /管理采集连接/ }).click();
  await expect(
    page.getByLabel('Bootstrap Servers', { exact: true }),
  ).toBeVisible();
});

// 抽屉键盘：打开、焦点移动、Escape 关闭与全部页面访问都可操作。
test('mobile drawer supports keyboard dismissal and all workspace pages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockAPIs(page);
  await page.goto('/');
  const menu = page.getByRole('button', { name: '展开导航', exact: true });
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(navigation).not.toBeVisible();
  await menu.click();
  await expect(
    page.getByRole('button', { name: '关闭导航', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(navigation).not.toBeVisible();
  await expect(menu).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    'hidden',
  );
  for (const [title, heading, group] of [
    ['运行总览', '模拟服务总览', '模拟服务'],
    ['模拟配置', '配置', '模拟服务'],
    ['数据监控', '数据监控'],
    ['运行总览', '运行总览', '采集网关'],
    ['节点监控', '节点监控'],
    ['连接配置', '连接配置'],
    ['网关设置', '网关设置'],
    ['系统总览', '系统总览'],
  ]) {
    await navigateTo(page, title, group);
    await expect(
      page.getByRole('heading', { name: heading, exact: true, level: 1 }),
    ).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    if (title === '模拟配置')
      await expect(
        page.getByLabel('刷新间隔（毫秒）', { exact: true }),
      ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      title,
    ).toBe(true);
  }
});

// 失败展示：网关不可用时不显示整体健康，保留明确错误提示。
test('overview reports unavailable gateway state without a healthy indicator', async ({
  page,
}) => {
  await mockAPIs(page);
  await page.route('**/api/gateway/capabilities', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 503, message: 'gateway unavailable' }),
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('gateway unavailable');
  await expect(page.getByText('数据链路运行正常', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText('网关状态暂不可用', { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: '采集数据链路' })
      .getByText('获取失败', { exact: true }),
  ).toHaveCount(3);
});
