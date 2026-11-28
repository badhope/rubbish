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
    await page.addInitScript(() => { document.cookie = 'rubbish_region=restricted; path=/' })
  })

  test('首页对匿名访问展示成员登录墙', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('仅对注册用户开放')).toBeVisible()
    await expect(page.getByRole('link', { name: '登录' })).toBeVisible()
  })

  test('受限会话恢复失败后可直接从封面登录', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('rubbish-auth')) {
        sessionStorage.setItem('rubbish-auth', JSON.stringify({ state: { token: 'old-session' }, version: 0 }))
      }
    })
    let probes = 0
    await page.route('**/api/auth/me', (route) => {
      probes++
      return route.fulfill({ status: 403, json: { detail: 'region_restricted' } })
    })

    await page.goto('/?lang=en')
    await expect(page.getByRole('heading', { name: 'Members only' })).toBeVisible()
    await expect(page.getByTestId('problem-dialog')).toHaveCount(0)
    await page.getByRole('link', { name: 'Sign in', exact: true }).click()
    await expect(page.locator('#username')).toBeEditable()
    expect(probes).toBe(1)
  })

  for (const [path, label, field] of [
    ['/login', '登录', '#username'],
    ['/register', '注册', '#email'],
  ] as const) {
    test(`旧封面的脚本停止响应时仍能进入${label}`, async ({ page }) => {
      await page.goto('/')
      const entry = page.getByRole('link', { name: label, exact: true })
      await expect(entry).toBeVisible()

      let oldDocument = true
      await page.route('**/*', (route) => {
        const request = route.request()
        if (request.isNavigationRequest()) oldDocument = false
        // Hold lazy imports from the already-open cover. A new document can load its own assets.
        if (oldDocument && request.resourceType() === 'script') return
        return route.continue()
      })
      await entry.click()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page.locator(field)).toBeEditable()
    })
  }

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
