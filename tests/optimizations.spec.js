import { test, expect } from '@playwright/test';
import { mockAPIs, openGateway, node } from './fixtures.js';

test('successful write stays locked until direct device readback completes', async ({
  page,
}) => {
  const state = await mockAPIs(page, { readbackDelay: 1200 });
  await openGateway(page, 'nodes');
  const row = page.locator('tr').filter({ hasText: '设备节点 1' }).first();
  await row.getByRole('button', { name: '写入', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('写入值', { exact: true }).fill('99');
  await dialog.getByRole('button', { name: '确认写入', exact: true }).click();
  await expect(dialog.getByText('写入已接受，正在回读当前值…')).toBeVisible();
  await expect(row.locator('button')).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: '关闭', exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByText(/已回读当前值：99/)).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.valueReads).toBe(1);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(
    row.getByRole('button', { name: '写入', exact: true }),
  ).toBeEnabled();
});

test('unknown write can be read again without resubmitting the command', async ({
  page,
}) => {
  const state = await mockAPIs(page, { writeFailure: true });
  await openGateway(page, 'nodes');
  await page.getByRole('button', { name: '写入', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('写入值', { exact: true }).fill('99');
  await dialog.getByRole('button', { name: '确认写入', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: '重新回读确认', exact: true }),
  ).toBeEnabled();
  expect(state.valueReads).toBe(0);
  await dialog
    .getByRole('button', { name: '重新回读确认', exact: true })
    .click();
  await expect(dialog.getByText(/原写入结果仍未知/)).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect(state.valueReads).toBe(1);
});

test('automatic monitoring uses cache and explicit refresh alone reads the device', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  await openGateway(page, 'nodes');
  await expect(page.getByText('设备节点 1', { exact: true })).toBeVisible();
  expect(state.cachedReads).toBeGreaterThan(0);
  expect(state.directReads).toBe(0);
  await page.getByRole('button', { name: '刷新节点', exact: true }).click();
  await expect.poll(() => state.cachedReads).toBeGreaterThan(1);
  expect(state.directReads).toBe(0);
  await page.getByRole('button', { name: '立即读取设备', exact: true }).click();
  await expect.poll(() => state.directReads).toBe(1);
});

test('rediscovery reports replacement catalog and acknowledged snapshot', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  await openGateway(page, 'nodes');
  await expect(page.getByText('设备节点 1', { exact: true })).toBeVisible();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新发现节点', exact: true }).click();
  await expect.poll(() => state.generation).toBe(2);
  await expect(page.getByText(/目录已更新：31 个节点/)).toBeVisible();
});

test('history restores only an editable draft and preserves the running configuration', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  await openGateway(page, 'connections');
  await page
    .getByLabel('Bootstrap Servers', { exact: true })
    .fill('localhost:19098');
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  await page.getByText('配置差异与历史版本', { exact: true }).click();
  await expect(page.getByRole('button', { name: /载入草稿/ })).toBeVisible();
  await page.getByRole('button', { name: /载入草稿/ }).click();
  await expect(
    page.getByLabel('Bootstrap Servers', { exact: true }),
  ).toHaveValue('127.0.0.1:9092');
  expect(state.config.kafka_producer.brokers).toBe('localhost:19098');
  expect(state.saves).toHaveLength(1);
});

test('simulation import validates a draft and does not apply it until saved', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  await page.goto('/#server/monitor');
  await page.getByRole('link', { name: '模拟配置', exact: true }).click();
  const dialog = page.getByRole('form', { name: '模拟服务配置' });
  await dialog.getByLabel('导入模拟方案文件').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"nodes":[]}'),
  });
  await expect(dialog.getByRole('alert')).toContainText('rules');
  const draft = structuredClone(state.simulation.config);
  draft.tickMs = 250;
  await dialog.getByLabel('导入模拟方案文件').setInputFiles({
    name: 'scenario.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(draft)),
  });
  await expect(dialog.getByText(/模拟方案已校验并载入草稿/)).toBeVisible();
  expect(state.simulation.config.tickMs).toBe(100);
  await dialog.getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect.poll(() => state.simulation.config.tickMs).toBe(250);
});

test('large node catalogs are paged and simulation updates preserve other profiles', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  state.nodes = Array.from({ length: 1000 }, (_, i) =>
    node(i + 1, `测点 ${i + 1}`, 'FLOAT', String(i)),
  );
  state.simulation.config.nodes = state.nodes.map((n) => ({
    id: n.id,
    enabled: false,
    baseline: 10,
    min: 0,
    max: 100,
    amplitude: 0,
    intervalMs: 1000,
  }));
  await page.goto('/#server/monitor');
  await expect(page.getByText('测点 1', { exact: true })).toBeVisible();
  expect(await page.getByRole('row').count()).toBeLessThanOrEqual(101);
  await page.getByRole('link', { name: '模拟配置', exact: true }).click();
  const dialog = page.getByRole('form', { name: '模拟服务配置' });
  await expect(dialog.getByRole('row')).toHaveCount(51);
  await dialog.getByLabel('筛选模拟节点', { exact: true }).fill('1000');
  await dialog.getByLabel('基准值，节点 1000', { exact: true }).fill('20');
  await dialog.getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect.poll(() => state.simulation.config.nodes[999].baseline).toBe(20);
  expect(state.simulation.config.nodes[0].baseline).toBe(10);
});

test('key small text and controls meet the target contrast', async ({
  page,
}) => {
  await mockAPIs(page);
  await page.goto('/#server/monitor');
  await expect(page.getByText('出口温度', { exact: true })).toBeVisible();
  const samples = await page
    .locator('th,.metric small,.badge.good,.button.primary:not(:disabled)')
    .evaluateAll((elements) => {
      function luminance(rgb) {
        const c = rgb
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
        return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
      }
      return elements
        .filter((e) => e.checkVisibility())
        .map((e) => {
          const style = getComputedStyle(e);
          let p = e,
            bg;
          while (p) {
            const color = getComputedStyle(p).backgroundColor;
            if (color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') {
              bg = color;
              break;
            }
            p = p.parentElement;
          }
          const a = luminance(style.color),
            b = luminance(bg || 'rgb(255,255,255)');
          return {
            text: e.textContent,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        });
    });
  for (const sample of samples)
    expect(sample.ratio, sample.text).toBeGreaterThanOrEqual(4.5);
});

test('simulation runtime trace refresh does not replace an unsaved draft', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  state.simulation.config.rules = [
    {
      id: 'trace-rule',
      name: '运行规则',
      enabled: true,
      windowMs: 5000,
      steps: [{ nodeId: 1, operator: 'changed', value: '' }],
      outputs: [{ nodeId: 2, target: 20, delayMs: 0, durationMs: 3000 }],
    },
  ];
  await page.route('**/api/server/simulation/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        revision: 1,
        running: true,
        capturedAt: new Date().toISOString(),
        rules: [],
        events: [
          {
            sequence: 1,
            at: new Date().toISOString(),
            ruleId: 'trace-rule',
            nodeId: 1,
            value: '10',
            kind: 'triggered',
            detail: '顺序匹配完成，已安排输出',
          },
        ],
      }),
    }),
  );
  await page.goto('/#server/monitor');
  await page.getByRole('link', { name: '模拟配置', exact: true }).click();
  const dialog = page.getByRole('form', { name: '模拟服务配置' });
  await dialog.getByRole('tab', { name: '业务规则', exact: true }).click();
  await dialog.getByLabel('规则名称', { exact: true }).fill('未保存修改');
  await dialog
    .getByText('实时运行轨迹（最近 128 条，内存记录）', { exact: true })
    .click();
  await expect(
    dialog.getByText('顺序匹配完成，已安排输出', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel('规则名称', { exact: true })).toHaveValue(
    '未保存修改',
  );
  expect(state.simulation.config.rules[0].name).toBe('运行规则');
});

test('readback for an unresolved old machine never overwrites the selected machine', async ({
  page,
}) => {
  await mockAPIs(page, { writeFailure: true });
  const machine = (code) => ({
    code,
    server: 'opc.tcp://127.0.0.1:4840',
    topic: 'test',
    connected: true,
    ready: true,
    nodeCount: 1,
  });
  await page.route('**/api/gateway/status', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 200,
        data: {
          stationCode: 'test',
          machines: [machine('machine-1'), machine('machine-2')],
          kafka: {},
          kafkaConnection: { state: 'connected' },
        },
      }),
    }),
  );
  await page.route('**/api/gateway/nodes?**', (route) =>
    new URL(route.request().url()).searchParams.get('machine') === 'machine-2'
      ? route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            code: 200,
            data: {
              nodes: [
                {
                  code: '1:1',
                  name: '第二机组节点',
                  value: '100',
                  type: 'number',
                  quality: 0,
                  sourceTime: new Date().toISOString(),
                  observedAt: new Date().toISOString(),
                },
              ],
              total: 1,
              offset: 0,
              limit: 25,
              cached: true,
              capturedAt: new Date().toISOString(),
            },
          }),
        })
      : route.fallback(),
  );
  await openGateway(page, 'nodes');
  await page.getByRole('button', { name: '写入', exact: true }).first().click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('写入值', { exact: true }).fill('99');
  await dialog.getByRole('button', { name: '确认写入', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: '重新回读确认', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByLabel('选择机组', { exact: true }).selectOption('machine-2');
  const row = page.getByRole('row').filter({ hasText: '第二机组节点' });
  await expect(row.locator('td.value')).toHaveText('100');
  await page.getByRole('button', { name: '重新回读确认', exact: true }).click();
  await expect(
    page.getByText('已读取当前值（原写入未知）', { exact: true }),
  ).toBeVisible();
  await expect(row.locator('td.value')).toHaveText('100');
});
