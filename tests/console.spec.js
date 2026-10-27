/**
 * 核心业务浏览器回归：节点管理、版本冲突、模拟配置、只读和网关配置回滚。
 * 所有 API 由 mockAPIs 拦截，先模拟输入和按钮操作，再断言界面与请求记录。
 */
import { test, expect } from '@playwright/test';
import { openGateway, mockAPIs, navigateTo } from './fixtures.js';

// 模拟节点监控：筛选、文本转义、CSV 和增删改均应保留接口中的字符串值。
test('server filtering, escaped names, CSV export and node CRUD preserve string values', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#server/monitor');
  await expect(page.getByText('出口温度', { exact: true })).toBeVisible();
  // 验证包含 <script> 的节点名称仅作为纯文本渲染，不会触发 XSS 脚本执行。
  await expect(
    page.getByText('<script>window.injected=true</script>', { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  // 验证搜索框按关键字实时过滤，清空后恢复完整列表。
  await page.getByLabel('搜索节点名称或 NodeId').fill('转速');
  await expect(page.getByText('出口温度', { exact: true })).toHaveCount(0);
  await page.getByLabel('搜索节点名称或 NodeId').fill('');
  // 验证 CSV 导出触发浏览器下载且文件名符合预期。
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  expect((await download).suggestedFilename()).toBe('opc-nodes.csv');
  // 验证新增节点：高精度小数字符串原样提交，不因前端 Number 转换丢失末尾精度。
  await page.getByRole('button', { name: '新增节点', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('节点 ID', { exact: true }).fill('90001');
  await dialog.getByLabel('节点名称', { exact: true }).fill('新建节点');
  await dialog.getByLabel('初始值', { exact: true }).fill('1.2345678901234567');
  await dialog.getByRole('button', { name: '创建节点', exact: true }).click();
  await expect(page.getByText('新建节点', { exact: true })).toBeVisible();
  expect(state.mutations[0].value).toBe('1.2345678901234567');
  // 验证编辑节点：未勾选“同时修改当前值”时不发送 value 字段，且必须携带乐观锁 revision。
  const row = page.getByRole('row').filter({ hasText: '新建节点' });
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await dialog.getByLabel('节点名称', { exact: true }).fill('重命名节点');
  await dialog.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByText('重命名节点', { exact: true })).toBeVisible();
  expect(state.mutations[1]).not.toHaveProperty('value');
  expect(state.mutations[1].revision).toBe(1);
  // 验证删除节点：确认后节点从表格中移除，且全流程无页面未捕获异常。
  await page
    .getByRole('row')
    .filter({ hasText: '重命名节点' })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await dialog.getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('重命名节点', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// 版本冲突：保存返回 409 后，弹窗继续显示用户草稿，不静默覆盖。
test('server revision conflicts retain the edited draft', async ({ page }) => {
  await mockAPIs(page, { nodeConflict: true });
  await page.goto('/#server/monitor');
  await page
    .getByRole('row')
    .filter({ hasText: '出口温度' })
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('节点名称', { exact: true }).fill('保留我的草稿');
  await dialog.getByRole('button', { name: '保存修改' }).click();
  await expect(dialog.getByRole('alert')).toContainText('版本冲突');
  await expect(dialog.getByLabel('节点名称', { exact: true })).toHaveValue(
    '保留我的草稿',
  );
});

// 模拟方案：编辑节点动态参数与有序规则后，检查提交到模拟服务的配置。
test('simulation profiles and ordered rules save through the server API', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  await page.goto('/#server/monitor');
  await page.getByRole('link', { name: '模拟配置', exact: true }).click();
  const dialog = page.getByRole('form', { name: '模拟服务配置' });
  await dialog.getByLabel('刷新间隔（毫秒）', { exact: true }).fill('200');
  await dialog.getByRole('tab', { name: '业务规则', exact: true }).click();
  await dialog.getByRole('button', { name: '＋ 新增业务规则' }).click();
  await dialog.getByLabel('规则名称', { exact: true }).fill('温度联动');
  await dialog.getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect.poll(() => state.simulation.config.tickMs).toBe(200);
  expect(state.simulation.config.rules[0].name).toBe('温度联动');
  expect(state.simulation.config.rules[0].steps[0].operator).toBe('changed');
});

// 网关组合流程：自动连接、节点翻页，以及设备写入未知后不会自动重发。
test('gateway automatic connection, pagination and uncertain device writes do not retry', async ({
  page,
}) => {
  const state = await mockAPIs(page, { writeFailure: true });
  await openGateway(page, 'nodes');
  await expect(page.getByText('设备节点 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByText('设备节点 26', { exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: '设备节点 26' })
    .getByRole('button', { name: '写入', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('写入值', { exact: true }).fill('42');
  await dialog.getByRole('button', { name: '确认写入' }).click();
  // 写入返回 504 超时后，弹窗提示需回读确认，且只发送过 1 次写入请求、不在浏览器存储敏感信息。
  await expect(dialog.getByRole('alert')).toContainText('回读确认');
  await expect(
    dialog.getByRole('button', { name: '重新回读确认' }),
  ).toBeEnabled();
  expect(state.writes).toEqual([
    { machine: 'machine-1', code: '1:26', value: '42' },
  ]);
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).length + Object.keys(sessionStorage).length,
    ),
  ).toBe(0);
});

// 只读模式：即使节点已正常读取，写入按钮也应始终禁用。
test('read-only gateway never enables device write controls', async ({
  page,
}) => {
  await mockAPIs(page, { readOnly: true });
  await openGateway(page, 'nodes');
  await expect(page.getByText('设备节点 1', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '写入', exact: true }).first(),
  ).toBeDisabled();
  await expect(
    page.getByText('当前网关为设备只读模式，禁止写入。'),
  ).toBeVisible();
});

// 配置动作：校验、仅保存和明确重载分别产生不同的后端效果。
test('configuration validation, save-only and explicit file reload retain separate semantics', async ({
  page,
}) => {
  const state = await mockAPIs(page);
  await openGateway(page, 'connections');
  await page
    .getByLabel('Bootstrap Servers', { exact: true })
    .fill('localhost:19092');
  await page.getByRole('button', { name: '校验配置' }).click();
  await expect(page.getByText(/配置校验通过/)).toBeVisible();
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0].apply).toBe(false);
  expect(state.saves[0].revision).toBe('revision-1');
  await expect(page.getByText(/配置已保存，文件配置尚未应用/)).toBeVisible();
  await page.getByRole('button', { name: '重载文件', exact: true }).click();
  await expect.poll(() => state.reloads).toBe(1);
  await expect(page.getByText('配置已同步', { exact: false })).toBeVisible();
});

// 应用失败：展示文件回滚说明，并保留同一草稿供用户后续仅保存。
test('failed hot apply explains rollback and retains configuration for save-only', async ({
  page,
}) => {
  const state = await mockAPIs(page, { rollback: true });
  await openGateway(page, 'connections');
  await page
    .getByLabel('Bootstrap Servers', { exact: true })
    .fill('localhost:19093');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('原配置文件已恢复');
  await expect(
    page.getByLabel('Bootstrap Servers', { exact: true }),
  ).toHaveValue('localhost:19093');
  await page.getByRole('button', { name: '仅保存', exact: true }).click();
  await expect.poll(() => state.saves.length).toBe(2);
  expect(state.saves[1].apply).toBe(false);
});

// 网络故障：配置草稿保留，服务恢复后直接继续使用，不引入登录弹窗。
test('gateway failures preserve configuration drafts and recover without a login prompt', async ({
  page,
}) => {
  await mockAPIs(page);
  await openGateway(page, 'connections');
  await page
    .getByLabel('Bootstrap Servers', { exact: true })
    .fill('localhost:19094');
  await page.route('**/api/gateway/status', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 503, message: 'temporary gateway failure' }),
    }),
  );
  await page
    .getByRole('region', { name: '采集网关', exact: true })
    .getByRole('link', { name: '运行总览', exact: true })
    .click();
  await page.getByRole('button', { name: '刷新状态', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'temporary gateway failure',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('管理令牌', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '连接配置', exact: true }).click();
  await expect(
    page.getByLabel('Bootstrap Servers', { exact: true }),
  ).toHaveValue('localhost:19094');
  await page.unroute('**/api/gateway/status');
  await page
    .getByRole('region', { name: '采集网关', exact: true })
    .getByRole('link', { name: '运行总览', exact: true })
    .click();
  await page.getByRole('button', { name: '刷新状态', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('machine-1', { exact: true })).toBeVisible();
});

// 移动布局：页面不横向溢出，两个服务入口和核心操作仍可访问。
test('mobile layout fits the viewport and both service modules remain reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAPIs(page);
  await page.goto('/#server/monitor');
  await expect(page.getByText('出口温度', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await navigateTo(page, '运行总览', '采集网关');
  await expect(page.getByText('machine-1', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await navigateTo(page, '系统总览');
  await expect(
    page.getByRole('heading', { name: '系统总览', exact: true }),
  ).toBeVisible();
});
