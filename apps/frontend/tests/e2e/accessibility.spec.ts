import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

import { ADMIN, loginViaUi, primeCookieConsent } from './helpers'

async function expectNoSeriousA11y(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
  const serious = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  )
  if (serious.length) {
    throw new Error(
      `${label} 无障碍严重问题:\n` +
        serious
          .map(
            (v) =>
              `- [${v.impact}] ${v.id}: ${v.help}\n  节点: ${v.nodes
                .map((n) => n.target.join(' '))
                .slice(0, 6)
                .join(' | ')}`,
          )
          .join('\n'),
    )
  }
  expect(serious).toHaveLength(0)
}

test.describe('无障碍基线', () => {
  test('公开页无严重 WCAG A/AA 问题', async ({ page }) => {
    await primeCookieConsent(page)
    for (const path of ['/guide', '/about', '/privacy']) {
      await page.goto(path)
      await expect(page.locator('main')).toBeVisible()
      await expectNoSeriousA11y(page, path)
    }
  })

  test('登录后的核心页无严重 WCAG A/AA 问题', async ({ page }) => {
    await loginViaUi(page, ADMIN)
    for (const path of ['/', '/forum', '/catalog', '/submissions/new', '/me', '/admin/people?section=users']) {
      await page.goto(path)
      await expect(page.locator('main')).toBeVisible()
      await expectNoSeriousA11y(page, path)
    }
  })
})
