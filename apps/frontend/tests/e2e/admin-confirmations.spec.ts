import { expect, test } from '@playwright/test'

import { ADMIN, loginViaUi, nextTestUser } from './helpers'

test.describe('后台高风险动作确认链路', () => {
  test('成员角色撤销/分配、账号禁用/启用都要确认后才落库', async ({ page }) => {
    const user = nextTestUser('confirm')
    await loginViaUi(page, ADMIN)
    // Firefox 在 dev server 下等 load 会被中断的模块请求带成 NS_ERROR_FAILURE；
    // 这里只关心页面可用，等到 DOM 就绪后直接等下一条断言。
    await page.goto('/admin/people?section=users', { waitUntil: 'domcontentloaded' })

    await expect(page.getByRole('button', { name: '新增成员' })).toBeVisible()
    await page.getByRole('button', { name: '新增成员' }).click()
    const createDialog = page.getByRole('dialog')
    await createDialog.getByLabel('邮箱').fill(user.email)
    await createDialog.getByLabel('用户名').fill(user.username)
    await createDialog.getByRole('button', { name: '创建并邀请' }).click()
    await expect(page.getByText(/账号已创建/)).toBeVisible({ timeout: 15_000 })

    const row = () => page.getByRole('row', { name: new RegExp(user.username) })
    await page.getByPlaceholder('搜索用户名或邮箱').fill(user.username)
    await expect(row()).toBeVisible()
    await expect(row().getByText('互评成员', { exact: true })).toBeVisible()

    // 1) 撤销角色：先确认，再校验列表已刷新
    await row().getByRole('button', { name: '用户操作' }).click()
    await page.getByRole('menuitemcheckbox', { name: '互评成员', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('撤销「互评成员」角色')
    await page.getByRole('button', { name: '撤销角色' }).click()
    await expect(page.getByText('已撤销 互评成员 角色')).toBeVisible({ timeout: 15_000 })
    await expect(row().getByText('互评成员', { exact: true })).toHaveCount(0)

    // 2) 再分配：同样先确认，确认后才出现角色
    await row().getByRole('button', { name: '用户操作' }).click()
    await page.getByRole('menuitemcheckbox', { name: '互评成员', exact: true }).click()
    await expect(page.getByRole('alertdialog')).toContainText('分配「互评成员」角色')
    await page.getByRole('button', { name: '分配角色' }).click()
    await expect(page.getByText('已分配 互评成员 角色')).toBeVisible({ timeout: 15_000 })
    await expect(row().getByText('互评成员', { exact: true })).toBeVisible()

    // 3) 禁用账号：确认后状态变“禁用”
    await row().getByRole('button', { name: '用户操作' }).click()
    await page.getByRole('menuitem', { name: '禁用账号' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('禁用这个账号')
    await page.getByRole('button', { name: '禁用账号' }).click()
    await expect(page.getByText('已禁用')).toBeVisible({ timeout: 15_000 })
    await expect(row().getByText('禁用', { exact: true })).toBeVisible()

    // 4) 再启用：确认后状态回到“启用”
    await row().getByRole('button', { name: '用户操作' }).click()
    await page.getByRole('menuitem', { name: '启用账号' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('启用这个账号')
    await page.getByRole('button', { name: '启用账号' }).click()
    await expect(page.getByText('已启用')).toBeVisible({ timeout: 15_000 })
    await expect(row().getByText('启用', { exact: true })).toBeVisible()
  })
})
