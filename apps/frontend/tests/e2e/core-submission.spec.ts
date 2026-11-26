import { expect, test } from '@playwright/test'

import {
  ADMIN,
  fillSubmissionWizard,
  loginViaUi,
  openSubmissionForm,
} from './helpers'

test.describe('作者投稿主链路', () => {
  test('新建投稿提交后落库并回到列表可见', async ({ page }) => {
    await loginViaUi(page, ADMIN)
    await page.goto('/submissions')

    const title = `E2E 链路验收 ${Date.now()}`
    await openSubmissionForm(page)
    await fillSubmissionWizard(page, {
      title,
      discipline: '计算机科学',
      abstract: '这是一条端到端验收投稿，用于验证提交、落库与列表刷新。',
      authors: 'E2E 验收员',
    })

    await page.getByRole('main').getByRole('button', { name: '投稿', exact: true }).click()
    await expect(page.getByText('已提交，等待内容整理处理')).toBeVisible({ timeout: 20_000 })
    await page.waitForURL(/\/submissions(?:[?#]|$)/, { timeout: 20_000 })
    await expect(page.getByText(title, { exact: false })).toBeVisible({ timeout: 20_000 })
  })
})
