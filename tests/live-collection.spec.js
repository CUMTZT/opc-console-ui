/**
 * 可选真实采集验收：只有显式 LIVE_COLLECTION=1 才执行，普通测试默认跳过。
 * 会操作隔离设备节点并等待真实回读，需自行准备隔离 Go/Kafka 环境，不连接生产。
 */
import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// 真实采集可选验收：新增节点后重新发现、写入并回读，需显式隔离环境。
test('browser discovers a new real node, writes it and confirms device readback', async ({
  page,
}) => {
  test.skip(
    process.env.LIVE_COLLECTION !== '1',
    'Requires isolated Go services and Kafka',
  );
  test.setTimeout(90000);
  const id = Number(process.env.TEST_NODE_ID || 4000765432),
    name = `UI采集联调-${id}`,
    wanted = '65.75';
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/#server');
  await page.getByRole('button', { name: '新增节点', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('节点 ID', { exact: true }).fill(String(id));
  await dialog.getByLabel('节点名称', { exact: true }).fill(name);
  await dialog.getByLabel('初始值', { exact: true }).fill('12.5');
  await dialog.getByRole('button', { name: '创建节点', exact: true }).click();
  try {
    await page.getByLabel('搜索节点名称或 NodeId').fill(String(id));
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '节点监控', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '重新发现节点', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('button', { name: '重新发现节点', exact: true })
      .click();
    await page.getByLabel('搜索设备节点').fill(String(id));
    await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible({
      timeout: 25000,
    });
    await page
      .getByRole('row')
      .filter({ hasText: name })
      .getByRole('button', { name: '写入', exact: true })
      .click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('写入值', { exact: true }).fill(wanted);
    await dialog.getByRole('button', { name: '确认写入', exact: true }).click();
    await expect(dialog.getByText(/已回读当前值：65.75/)).toBeVisible();
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    if (process.env.COLLECTION_EVIDENCE)
      await writeFile(
        process.env.COLLECTION_EVIDENCE,
        JSON.stringify({
          nodeId: id,
          code: `1:${id}`,
          value: wanted,
          at: new Date().toISOString(),
        }) + '\n',
      );
  } finally {
    await page.goto('/#server');
    await page.getByLabel('搜索节点名称或 NodeId').fill(String(id));
    const row = page.getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(row).toHaveCount(0);
  }
});
