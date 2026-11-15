// 巡检：逐个页面检查是否落在空状态（截图用）。
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const SHOTS = [
  ['/', 'home'],
  ['/catalog', 'catalog'],
  ['/catalog/1', 'detail'],
  ['/dashboard', 'dashboard'],
  ['/submissions/pending', 'editor'],
  ['/review/assignments', 'reviewer'],
  ['/submissions', 'my-sub'],
  ['/admin/users', 'users'],
  ['/admin/audit-logs', 'audit'],
  ['/ingest', 'ingest'],
  ['/recommendations', 'rec'],
  ['/library', 'library'],
  ['/notifications', 'notif'],
  ['/admin/journal', 'journal'],
  ['/follows', 'follows'],
  ['/account', 'account'],
  ['/settings', 'settings'],
]
const EMPTY = [/暂无/, /还没有/, /空空如也/, /暂时没有/, /没有任何/]

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() =>
  window.localStorage.setItem('rubbish_cookie_consent', 'accepted'),
)
const p = await ctx.newPage()
p.setDefaultTimeout(20000)
await p.goto(`${BASE}/login`)
await p.getByLabel('用户名或邮箱').fill('admin')
await p.getByLabel('密码', { exact: true }).fill('e2e_admin_pw_12345678')
await p.getByRole('button', { name: '登录' }).click()
await p.waitForURL(/dashboard/, { timeout: 20000 })

for (const [path, name] of SHOTS) {
  await p.goto(`${BASE}${path}`)
  await p.waitForTimeout(1500)
  const txt = await p.evaluate(() =>
    document.body.innerText.replace(/\s+/g, ' ').slice(0, 200),
  )
  const hit = EMPTY.filter((r) => r.test(txt)).map(String)
  const mark = hit.length ? 'WARN' : 'OK  '
  console.log(`${mark} ${name.padEnd(11)} ${hit.join(',')} | ${txt.slice(0, 100)}`)
}
await b.close()
