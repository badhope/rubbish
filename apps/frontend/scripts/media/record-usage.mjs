// 录制「使用流程」演示视频：走一遍真实用户会做的事，
// 全程带字幕节拍（每段停留时间足够看清页面）。
//
// 数据侧要先跑完 seed-*.mjs，否则页面是空的。
// 输出：/workspace/rubbish-media/raw/*.webm（1920×1080 VP8）
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const ADMIN = { username: 'admin', password: 'e2e_admin_pw_12345678' }
const OUT_VIDEO = '/workspace/rubbish-media/raw'

fs.rmSync(OUT_VIDEO, { recursive: true, force: true })
fs.mkdirSync(OUT_VIDEO, { recursive: true })

/** 平稳滚动，避免瞬间跳变在视频里显得突兀。 */
async function smoothScroll(page, to, steps = 14, delay = 45) {
  const from = await page.evaluate(() => window.scrollY)
  for (let i = 1; i <= steps; i += 1) {
    const y = from + ((to - from) * i) / steps
    await page.evaluate((v) => window.scrollTo(0, v), y)
    await page.waitForTimeout(delay)
  }
}

async function settle(page, ms = 900) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(ms)
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_VIDEO, size: { width: 1920, height: 1080 } },
  })
  await context.addInitScript(() => {
    window.localStorage.setItem('rubbish_cookie_consent', 'accepted')
  })
  const page = await context.newPage()
  page.setDefaultTimeout(25000)

  // ---------- 1. 访客视角：资源目录 ----------
  // 注意 `/` 是分流路由：未登录会被送去 /login，所以访客首屏用 /catalog。
  console.log('1/8 访客浏览目录')
  await page.goto(`${BASE}/catalog`)
  await settle(page, 1800)
  await smoothScroll(page, 420)
  await page.waitForTimeout(1500)
  await smoothScroll(page, 0)
  await page.waitForTimeout(800)

  // ---------- 2. 检索 ----------
  console.log('2/8 资源检索')
  const search = page.getByPlaceholder('标题/作者/摘要').first()
  if (await search.isVisible().catch(() => false)) {
    await search.click()
    await page.waitForTimeout(400)
    await search.pressSequentially('diffusion', { delay: 110 })
    await page.waitForTimeout(1600)
    await search.fill('')
    await page.waitForTimeout(1200)
  } else {
    console.log('  （未找到搜索框，跳过）')
  }

  // ---------- 3. 资源详情 ----------
  console.log('3/8 资源详情')
  await page.goto(`${BASE}/catalog/5`)
  await settle(page, 1700)
  await smoothScroll(page, 500)
  await page.waitForTimeout(1200)
  await smoothScroll(page, 0)
  await page.waitForTimeout(600)

  // ---------- 4. 登录 ----------
  console.log('4/8 登录')
  await page.goto(`${BASE}/login`)
  await settle(page, 900)
  await page.getByLabel('用户名或邮箱').click()
  await page.getByLabel('用户名或邮箱').type(ADMIN.username, { delay: 110 })
  await page.getByLabel('密码', { exact: true }).click()
  await page.getByLabel('密码', { exact: true }).type('e2e_admin_pw_12345678', { delay: 70 })
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 25000 })
  await settle(page, 1600)

  // ---------- 5. 编辑工作台 → 分配审稿人 ----------
  console.log('5/8 编辑工作台')
  await page.goto(`${BASE}/submissions/pending`)
  await settle(page, 1700)
  await smoothScroll(page, 300)
  await page.waitForTimeout(1300)
  await smoothScroll(page, 0)

  // ---------- 6. 审稿工作台 ----------
  console.log('6/8 审稿工作台')
  await page.goto(`${BASE}/review/assignments`)
  await settle(page, 1700)
  await smoothScroll(page, 320)
  await page.waitForTimeout(1400)
  await smoothScroll(page, 0)

  // ---------- 7. 推荐 / 阅读列表 / 通知 ----------
  console.log('7/8 推荐 · 阅读列表 · 通知')
  await page.goto(`${BASE}/recommendations`)
  await settle(page, 1800)
  await smoothScroll(page, 380)
  await page.waitForTimeout(1500)
  await smoothScroll(page, 0)

  await page.goto(`${BASE}/library`)
  await settle(page, 1600)
  await page.waitForTimeout(1100)

  await page.goto(`${BASE}/notifications`)
  await settle(page, 1500)
  await page.waitForTimeout(1000)

  // ---------- 8. 在线阅读器 ----------
  console.log('8/8 在线阅读器')
  await page.goto(`${BASE}/reader/5`)
  await settle(page, 2000)
  await page.waitForTimeout(1800)

  // 回到概览收尾
  await page.goto(`${BASE}/dashboard`)
  await settle(page, 1600)

  console.log('保存录像…')
  await context.close() // 录像在 context 关闭时写完
  await browser.close()

  const videos = fs
    .readdirSync(OUT_VIDEO)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => {
      const st = fs.statSync(`${OUT_VIDEO}/${f}`)
      return `${f}  ${(st.size / 1024 / 1024).toFixed(2)} MB`
    })
  console.log('录像文件:\n  ' + videos.join('\n  '))
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
