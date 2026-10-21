import { test, expect } from '@playwright/test';

test('external React console works with real Go APIs through its proxy', async ({
  page,
}) => {
  test.skip(
    process.env.LIVE_APIS !== '1',
    'Explicitly enable isolated live API verification',
  );
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/#server/monitor');
  await expect(
    page.getByRole('button', { name: '新增节点', exact: true }),
  ).toBeEnabled();
  const id = 4000000000 + Math.floor(Math.random() * 1000000),
    name = `React联调-${id}`;
  await page.getByRole('button', { name: '新增节点', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('节点 ID', { exact: true }).fill(String(id));
  await dialog.getByLabel('节点名称', { exact: true }).fill(name);
  await dialog.getByLabel('初始值', { exact: true }).fill('12.345678901234567');
  await dialog.getByRole('button', { name: '创建节点', exact: true }).click();
  try {
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '编辑', exact: true }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('节点名称', { exact: true }).fill(name + '-已编辑');
    await dialog.getByRole('button', { name: '保存修改' }).click();
    await expect(
      page.getByText(name + '-已编辑', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: '配置', exact: true }).click();
    const editor = page.getByRole('form', { name: '模拟服务配置' });
    await expect(
      editor.getByLabel('刷新间隔（毫秒）', { exact: true }),
    ).toBeVisible();
    await page.getByRole('link', { name: '数据监控', exact: true }).click();
    await page.screenshot({
      path: 'test-results/server-desktop.png',
      fullPage: false,
    });
    await page.getByRole('link', { name: '运行总览', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: '连接采集网关' }),
    ).toHaveCount(0);
    await page.getByRole('link', { name: '连接配置', exact: true }).click();
    await expect(
      page.getByLabel('Bootstrap Servers', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '校验配置' }).click();
    await expect(page.getByText(/配置校验通过/)).toBeVisible();
    await page.screenshot({
      path: 'test-results/gateway-desktop.png',
      fullPage: false,
    });
  } finally {
    await page.goto('/#server');
    await page.getByLabel('搜索节点名称或 NodeId').fill(String(id));
    const row = page.getByRole('row').filter({ hasText: String(id) });
    await row.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '确认删除' }).click();
    await expect(row).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
