import { expect, test } from '@playwright/test'

const publicRoutes = [
  ['/forum', '社区'],
  ['/catalog', '档案'],
  ['/guide', '指南'],
  ['/about', '关于'],
  ['/privacy', '隐私'],
] as const

test.describe('public community shell', () => {
  test('home renders without a login wall', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status() ?? 0).toBeLessThan(400)
    await expect(page.locator('body')).toBeVisible()
    await expect(page.getByText('Rubbish', { exact: true }).first()).toBeVisible()
  })

  for (const [path, label] of publicRoutes) {
    test(`${label} loads without a login wall`, async ({ page }) => {
      const response = await page.goto(path)
      expect(response?.status() ?? 0).toBeLessThan(400)
      await expect(page.locator('body')).toBeVisible()
      await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
    })
  }

  test('desktop navigation keeps the five entrances', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/forum')
    const nav = page.getByRole('navigation', { name: '主导航' })
    for (const label of ['首页', '社区', '档案', '指南', '我的']) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible()
    }
  })

  test('mobile bottom navigation keeps the same five entrances', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/forum')
    const nav = page.getByRole('navigation', { name: '主导航' })
    for (const label of ['首页', '社区', '档案', '指南', '我的']) {
      await expect(nav.getByText(label, { exact: true })).toBeVisible()
    }
  })
})
