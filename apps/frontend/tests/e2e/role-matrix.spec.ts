import { expect, test, type Page } from '@playwright/test'

import {
  ADMIN,
  loginViaUi,
  nextTestUser,
  registerAndVerifyViaUi,
  setUserRole,
} from './helpers'

function tokenOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = window.sessionStorage.getItem('rubbish-auth')
    return JSON.parse(raw ?? '{}')?.state?.token ?? ''
  })
}

async function apiStatus(page: Page, path: string, token: string): Promise<number> {
  const res = await page.request.get(new URL(path, page.url()).toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.status()
}

test.describe('角色权限矩阵', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', '权限矩阵跑一次即可')

  test('作者→互评→编辑逐级升权，后台接口始终只对管理员开放', async ({ page, browser }) => {
    const member = nextTestUser('matrix')
    await registerAndVerifyViaUi(page, member)
    await loginViaUi(page, member)
    const token = await tokenOf(page)

    // 普通作者：自己的资料可读，编辑部与后台一律 403。
    expect(await apiStatus(page, '/api/users/me', token)).toBe(200)
    expect(await apiStatus(page, '/api/review/workbench', token)).toBe(403)
    expect(await apiStatus(page, '/api/editor/workbench', token)).toBe(403)
    expect(await apiStatus(page, '/api/admin/users', token)).toBe(403)

    const adminPage = await browser.newPage()
    await loginViaUi(adminPage, ADMIN)

    // 互评成员：只多开互评工作台，仍未拿到编辑与后台权限。
    await setUserRole(adminPage, member.username, 'reviewer')
    expect(await apiStatus(page, '/api/review/workbench', token)).toBe(200)
    expect(await apiStatus(page, '/api/editor/workbench', token)).toBe(403)
    expect(await apiStatus(page, '/api/admin/users', token)).toBe(403)

    // 内容整理：多开编辑工作台，后台依旧 403。
    await setUserRole(adminPage, member.username, 'editor')
    expect(await apiStatus(page, '/api/editor/workbench', token)).toBe(200)
    expect(await apiStatus(page, '/api/admin/users', token)).toBe(403)

    // 撤销后立即收回，不能靠前端缓存继续用。
    await setUserRole(adminPage, member.username, 'editor', false)
    expect(await apiStatus(page, '/api/editor/workbench', token)).toBe(403)

    // 管理员本人：后台与编辑工作台均可用。
    const adminToken = await tokenOf(adminPage)
    expect(await apiStatus(adminPage, '/api/admin/users', adminToken)).toBe(200)
    expect(await apiStatus(adminPage, '/api/editor/workbench', adminToken)).toBe(200)
  })
})
