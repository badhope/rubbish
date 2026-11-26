import { expect, test } from '@playwright/test'

import { ADMIN, loginViaUi } from './helpers'

const adminPages = [
  ['/admin', '站点总览'],
  ['/admin/people?section=users', '成员管理'],
  ['/admin/people?section=claims', '认领'],
  ['/admin/people?section=roles', '角色申请'],
  ['/admin/content?section=moderation', '内容核验队列'],
  ['/admin/content?section=forum', '主题巡检'],
  ['/admin/content?section=announcements', '公告管理'],
  ['/admin/content?section=boards', '讨论分区'],
  ['/admin/content?section=reports', '举报处置'],
  ['/admin/content?section=comments', '评论审核'],
  ['/admin/content?section=appeals', '作者申诉'],
  ['/admin/economy', '经验与货品'],
  ['/admin/system?section=health', '系统健康'],
  ['/admin/system?section=audit', '审计日志'],
] as const

test.describe('后台十四个业务页', () => {
  test('逐页可打开且标题正确，不落 404/错误页', async ({ page }) => {
    await loginViaUi(page, ADMIN)

    for (const [path, title] of adminPages) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByText('404', { exact: true })).toHaveCount(0)
      await expect(page.getByText('页面不存在', { exact: true })).toHaveCount(0)
    }
  })
})
