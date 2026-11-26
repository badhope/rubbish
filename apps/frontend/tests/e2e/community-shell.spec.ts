import { expect, test } from '@playwright/test'

import { ADMIN, loginViaUi, primeCookieConsent } from './helpers'

const publicRoutes = [
  ['/guide', '指南'],
  ['/about', '关于'],
  ['/privacy', '隐私'],
] as const

test.describe('匿名访问与登录墙', () => {
  test.beforeEach(async ({ page }) => {
    await primeCookieConsent(page)
  })

  test('首页对匿名访问展示成员登录墙', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('仅对注册用户开放')).toBeVisible()
    await expect(page.getByRole('link', { name: '登录' })).toBeVisible()
  })

  for (const path of ['/forum', '/catalog']) {
    test(`${path} 对匿名访问回落到登录墙`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByText('仅对注册用户开放')).toBeVisible()
    })
  }

  for (const [path, label] of publicRoutes) {
    test(`${label}页可匿名访问`, async ({ page }) => {
      const response = await page.goto(path)
      expect(response?.status() ?? 0).toBeLessThan(400)
      await expect(page.locator('body')).toBeVisible()
      await expect(page.getByText('仅对注册用户开放')).toHaveCount(0)
    })
  }
})

test.describe('登录后的社区壳', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, ADMIN)
  })

  test('桌面主导航保留完整入口', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/forum')
    const nav = page.getByRole('navigation', { name: '主导航' })
    for (const label of ['首页', '内容库', '卷', '主题论坛', '怎么用', '我的']) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible()
    }
  })

  test('移动端底部导航保留五个入口', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/forum')
    const nav = page.getByRole('navigation', { name: '主导航' })
    for (const label of ['首页', '主题论坛', '写', '内容库', '我的']) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible()
    }
  })
})
