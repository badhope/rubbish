import { expect, test } from '@playwright/test'

import { ADMIN, loginViaUi } from './helpers'

// 静态主路由冒烟：只证明页面能进、主内容区渲染、没有落到 404/错误页。
// 业务细节由 admin-pages、core-submission、role-matrix 等用例负责。
const ROUTES: { path: string; label: string }[] = [
  { path: '/', label: '首页' },
  { path: '/forum', label: '主题论坛' },
  { path: '/catalog', label: '内容库' },
  { path: '/content', label: '内容' },
  { path: '/economy', label: '经验' },
  { path: '/levels', label: '等级' },
  { path: '/issues', label: '卷期' },
  { path: '/people', label: '成员' },
  { path: '/tags', label: '标签' },
  { path: '/guide', label: '指南' },
  { path: '/about', label: '关于' },
  { path: '/privacy', label: '隐私' },
  { path: '/accessibility', label: '无障碍' },
  { path: '/status', label: '状态' },
  { path: '/search?q=E2E', label: '搜索' },
  { path: '/me', label: '我的空间' },
  { path: '/me?tab=library', label: '我的收藏' },
  { path: '/me?tab=notifications', label: '通知' },
  { path: '/me?tab=settings&section=ai', label: 'AI 接入设置' },
  { path: '/submissions', label: '我的作品' },
  { path: '/submissions/pending', label: '内容台' },
  { path: '/review', label: '互评工作台' },
  { path: '/editor/calibration', label: '互评校准' },
  { path: '/editor/issue-plan', label: '合集编排' },
  { path: '/system', label: '系统' },
  { path: '/403', label: '403' },
  { path: '/admin', label: '后台总览' },
]

test.describe('登录后静态主路由', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', '路由冒烟跑一次即可')

  test('全部静态主路由可渲染，不落 404/错误页', async ({ page }) => {
    await loginViaUi(page, ADMIN)
    for (const route of ROUTES) {
      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      expect(response?.status(), `${route.label} ${route.path} HTTP`).toBeLessThan(400)
      await expect(page.locator('main'), `${route.label} ${route.path} main`).toBeVisible({
        timeout: 15_000,
      })
      await expect(
        page.getByText(/页面不存在|找不到这个页面|404 Not Found/),
        `${route.label} ${route.path} 不应落 404`,
      ).toHaveCount(0)
      // 等 React Query 的首屏请求落地，避免把未完成的骨架当成成功。
      await page.waitForTimeout(400)
    }
  })
})
