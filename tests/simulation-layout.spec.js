/**
 * 模拟规则响应式回归：多个视口下检查表单布局并实际编辑控件。
 * 既检查几何尺寸，也验证控件能否输入，防止只看截图而漏掉操作问题。
 */
import { test, expect } from '@playwright/test';
import { mockAPIs } from './fixtures.js';

for (const viewport of [
  { width: 1440, height: 1080 },
  { width: 390, height: 844 },
]) {
  test(`business rules remain readable and editable at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const state = await mockAPIs(page);
    await page.goto('/#server/configuration');
    const nodesTab = page.getByRole('tab', { name: '节点动态值', exact: true });
    const rulesTab = page.getByRole('tab', { name: '业务规则', exact: true });
    await nodesTab.focus();
    await nodesTab.press('ArrowRight');
    await expect(rulesTab).toBeFocused();
    await expect(rulesTab).toHaveAttribute('aria-selected', 'true');
    const rules = page.getByRole('tabpanel', { name: '业务规则', exact: true });
    await rules
      .getByRole('button', { name: '＋ 新增业务规则', exact: true })
      .click();
    const enabled = rules.getByRole('checkbox', {
      name: '启用规则',
      exact: true,
    });
    await expect(enabled).toBeChecked();
    const checkbox = await enabled.boundingBox();
    const label = await rules
      .getByText('启用规则', { exact: true })
      .boundingBox();
    // 回归曾出现的布局问题：复选框误占整行，把旁边的标签挤成竖排。
    expect(Math.abs(checkbox.width - checkbox.height)).toBeLessThan(3);
    expect(label.height).toBeLessThanOrEqual(checkbox.height + 4);
    expect(label.width).toBeGreaterThan(label.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      rules.getByRole('heading', { name: '触发步骤', exact: true }),
    ).toBeVisible();
    await expect(
      rules.getByRole('heading', { name: '执行输出', exact: true }),
    ).toBeVisible();
    if (viewport.width > 700) {
      const input = await rules
        .getByLabel('第 1 步节点 ID', { exact: true })
        .boundingBox();
      const remove = await rules
        .getByRole('button', { name: '移除步骤', exact: true })
        .boundingBox();
      expect(
        Math.abs(input.y + input.height - remove.y - remove.height),
      ).toBeLessThan(3);
    }
    await rules.getByLabel('规则名称', { exact: true }).fill('温度顺序联动');
    await enabled.uncheck();
    await nodesTab.click();
    await rulesTab.click();
    await expect(rules.getByLabel('规则名称', { exact: true })).toHaveValue(
      '温度顺序联动',
    );
    await expect(enabled).not.toBeChecked();
    await page.getByRole('button', { name: '保存并应用', exact: true }).click();
    await expect
      .poll(() => state.simulation.config.rules[0]?.name)
      .toBe('温度顺序联动');
    expect(state.simulation.config.rules[0].enabled).toBe(false);
  });
}
