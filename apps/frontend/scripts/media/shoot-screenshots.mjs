// 截取 README / 文档用的界面截图（1440x900 桌面 + 390x844 移动端）。
// 依赖 seed 脚本已灌入的演示数据，否则页面是空的。
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const ADMIN = { username: 'admin', password: 'e2e_admin_pw_12345678' }
const OUT = '/workspace/rubbish-media/screenshots'
fs.mkdirSync(OUT, { recursive: true })

// 需要登录才能看的页面 / 以及各自的等待锚点
const SHOTS = [
  { name: '02-catalog', path: '/catalog', wait: 1600 },
  { name: '03-resource-detail', path: '/catalog/1', wait: 1600 },
  { name: '04-dashboard', path: '/dashboard', wait: 1500 },
  { name: '05-editor-workbench', path: '/submissions/pending', wait: 1600 },
  { name: '06-reviewer-workbench', path: '/review/assignments', wait: 1600 },
  { name: '07-my-submissions', path: '/submissions', wait: 1500 },
  { name: '08-admin-users', path: '/admin/users', wait: 1500 },
  { name: '09-admin-audit', path: '/admin/audit-logs', wait: 1500 },
  { name: '10-ingest', path: '/ingest', wait: 1400 },
  { name: '11-recommendations', path: '/recommendations', wait: 1500 },
  { name: '12-library', path: '/library', wait: 1400 },
  { name: '13-notifications', path: '/notifications', wait: 1400 },
  { name: '14-admin-journal', path: '/admin/journal', wait: 1400 },
  { name: '15-account-security', path: '/account/security', wait: 1400 },
  { name: '16-follows', path: '/follows', wait: 1400 },
  { name: '17-reader', path: '/reader/5', wait: 2000 },
]

// 顶部 `/` 只是个分流路由：登录后 → /dashboard，未登录 → /login。
// 所以"概览"截图不能用 `/`（会得到 dashboard 的副本），
// 这里直接把 04-dashboard 复制成 01-home，语义与画面一致。
const ALIASES = [['04-dashboard', '01-home']]

async function login(page) {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('用户名或邮箱').fill(ADMIN.username)
  await page.getByLabel('密码', { exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })
}

async function main() {
  const browser = await chromium.launch()

  // ---------- 桌面 1440x900 ----------
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await desk.addInitScript(() => {
    window.localStorage.setItem('rubbish_cookie_consent', 'accepted')
  })
  const page = await desk.newPage()
  page.setDefaultTimeout(20000)
  await login(page)

  for (const s of SHOTS) {
    await page.goto(`${BASE}${s.path}`)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(s.wait)
    await page.screenshot({ path: `${OUT}/${s.name}.png` })
    console.log(`  ✓ ${s.name}  ${s.path}`)
  }

  // ---------- 移动端 390x844（展示响应式） ----------
  const mob = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await mob.addInitScript(() => {
    window.localStorage.setItem('rubbish_cookie_consent', 'accepted')
  })
  const mpage = await mob.newPage()
  mpage.setDefaultTimeout(20000)
  await login(mpage)
  for (const s of [
    { name: 'mobile-catalog', path: '/catalog' },
    { name: 'mobile-detail', path: '/catalog/1' },
  ]) {
    await mpage.goto(`${BASE}${s.path}`)
    await mpage.waitForTimeout(1600)
    await mpage.screenshot({ path: `${OUT}/${s.name}.png` })
    console.log(`  ✓ ${s.name}`)
  }

  await browser.close()

  for (const [from, to] of ALIASES) {
    fs.copyFileSync(`${OUT}/${from}.png`, `${OUT}/${to}.png`)
    console.log(`  ⇄ ${to} ← ${from}`)
  }

  console.log(`\n截图输出目录: ${OUT}`)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
