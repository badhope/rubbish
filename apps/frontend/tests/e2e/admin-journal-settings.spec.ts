import { test, expect, type Page } from '@playwright/test'
import { ADMIN, loginViaUi } from './helpers'

// 期刊设置 —— 评审模式（单盲 / 双盲）。
//
// 该设置是租户级全局状态，会影响审稿工作台里审稿人能看到的作者信息。
// E2E 串行执行（workers=1），但仍必须在用例结束时复位为 single_blind，
// 否则后续 submissions-review 用例对作者字段的断言会被污染。

async function selectMode(page: Page, mode: 'single_blind' | 'double_blind') {
  await page.getByTestId(`review-mode-${mode}`).click()
  await page.getByTestId('save-review-mode').click()
}

test.describe('admin: journal settings', () => {
  test.afterEach(async ({ browser }) => {
    // 兜底复位：即便用例中途失败，也把租户恢复成默认单盲
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await loginViaUi(page, ADMIN)
      await page.goto('/admin/settings')
      const single = page.getByTestId('review-mode-single_blind')
      await single.waitFor({ state: 'visible', timeout: 10_000 })
      if (!(await single.getByRole('radio').isChecked())) {
        await selectMode(page, 'single_blind')
        await expect(page.getByTestId('save-review-mode')).toBeDisabled()
      }
    } finally {
      await ctx.close()
    }
  })

  test('admin can switch review mode between single and double blind', async ({
    page,
  }) => {
    await loginViaUi(page, ADMIN)
    await page.goto('/admin/settings')

    await expect(page.getByRole('heading', { name: '期刊设置' })).toBeVisible()

    // 默认单盲：单盲选项被选中，且「当前生效」标记落在单盲上
    const singleOption = page.getByTestId('review-mode-single_blind')
    const doubleOption = page.getByTestId('review-mode-double_blind')
    await expect(singleOption.getByRole('radio')).toBeChecked()
    await expect(singleOption).toContainText('当前生效')

    // 未改动时保存按钮禁用
    await expect(page.getByTestId('save-review-mode')).toBeDisabled()

    // 切到双盲
    await selectMode(page, 'double_blind')
    await expect(doubleOption).toContainText('当前生效', { timeout: 10_000 })
    await expect(page.getByTestId('save-review-mode')).toBeDisabled()

    // 刷新后仍然是双盲，说明确实落库而不是只改了本地状态
    await page.reload()
    await expect(doubleOption.getByRole('radio')).toBeChecked({ timeout: 10_000 })
    await expect(doubleOption).toContainText('当前生效')

    // 切回单盲
    await selectMode(page, 'single_blind')
    await expect(singleOption).toContainText('当前生效', { timeout: 10_000 })
  })

  test('non-admin cannot reach journal settings', async ({ page }) => {
    await page.goto('/admin/settings')
    // 未登录 / 非管理员被 beforeLoad 重定向到登录页
    await expect(page).toHaveURL(/\/login/)
  })
})
