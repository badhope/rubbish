// 给 admin 补上"读者侧"数据，让 /library、/follows、/recommendations
// 都是饱满画面 —— 截图与宣传片需要真实数据，不能是空状态。
//
// 全部操作都走真实 UI 路径（阅读列表弹窗、详情页关注卡片、阅读器），
// 因此这里的数据形态与真实用户使用后完全一致。
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const ADMIN = { username: 'admin', password: 'e2e_admin_pw_12345678' }

const LISTS = [
  { name: '深度学习必读', desc: '从表征学习到检索增强生成的主线论文。' },
  { name: '方法学与统计', desc: '做实验前应该先读的推断与设计文献。' },
  { name: '跨学科灵感', desc: '物理、生物与工程里可迁移的建模思路。' },
]

async function login(page) {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('用户名或邮箱').fill(ADMIN.username)
  await page.getByLabel('密码', { exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })
}

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    window.localStorage.setItem('rubbish_cookie_consent', 'accepted')
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  await login(page)

  // 1) 建阅读列表
  for (const l of LISTS) {
    await page.goto(`${BASE}/library`)
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /新建列表|新建你的第一个列表/ }).first().click()
    await page.getByRole('dialog', { name: '新建列表' }).waitFor({ state: 'visible' })
    await page.getByLabel('名称').fill(l.name)
    await page.getByLabel('描述（选填）').fill(l.desc)
    await page.getByRole('button', { name: /^(创建|保存|确定)/ }).first().click()
    await page.waitForTimeout(1000)
    console.log(`  ✓ 列表: ${l.name}`)
  }

  // 2) 详情页：加入阅读列表 + 关注作者 + 订阅学科
  const detailIds = ['1', '2', '5', '7', '8']
  let followed = 0
  let subscribed = 0
  let addedToList = 0

  for (const id of detailIds) {
    await page.goto(`${BASE}/catalog/${id}`)
    await page.waitForTimeout(1000)

    // 2a) 加入阅读列表
    const addBtn = page.getByRole('button', { name: /加入阅读列表/ }).first()
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click()
      await page.waitForTimeout(600)
      const option = page.getByRole('menuitem').first().or(page.getByRole('option').first())
      if (await option.isVisible().catch(() => false)) {
        await option.click().catch(() => {})
        await page.waitForTimeout(700)
        addedToList += 1
      }
    }

    // 2b) 关注作者：按钮只有「关注」时才点，避免把已关注取消掉
    const followBtn = page
      .getByRole('button', { name: /^关注$/ })
      .or(page.getByRole('button', { name: '关注', exact: true }))
      .first()
    if (await followBtn.isVisible().catch(() => false)) {
      await followBtn.click().catch(() => {})
      await page.waitForTimeout(500)
      followed += 1
    }

    // 2c) 订阅学科
    const subBtn = page.getByRole('button', { name: '订阅', exact: true }).first()
    if (await subBtn.isVisible().catch(() => false)) {
      await subBtn.click().catch(() => {})
      await page.waitForTimeout(500)
      subscribed += 1
    }
    console.log(`  ✓ /catalog/${id} 已处理`)
  }

  // 3) 打开阅读器产生阅读历史 —— 推荐引擎靠这个建画像
  for (const id of ['1', '4', '5']) {
    await page.goto(`${BASE}/reader/${id}`)
    await page.waitForTimeout(1800)
    console.log(`  ✓ 阅读历史: /catalog/${id}`)
  }

  await browser.close()
  console.log(
    `读者侧数据完成：列表 ${LISTS.length} · 加入列表 ${addedToList} · 关注 ${followed} · 订阅 ${subscribed}`,
  )
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
