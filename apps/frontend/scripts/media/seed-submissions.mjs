// 灌入投稿 / 审稿流程数据：让「我的提交 / 编辑工作台 / 审稿工作台」
// 三个核心页面有真实内容可截可录。
//
// 造 3 条不同状态的投稿：
//   A) 刚投递、未分配审稿人（pending）
//   B) 已分配审稿人、审稿人已接受邀请（under_review）
//   C) 已收到审稿报告，等待编辑裁决（pending decision）
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const ADMIN = { username: 'admin', password: 'e2e_admin_pw_12345678' }
const API = 'http://localhost:8000'

const PAPERS = [
  {
    title: 'Contrastive Pretraining Without Negative Samples for Tabular Data',
    authors: 'Mei Tanaka, Rafael Souza',
    abstract:
      'Contrastive objectives for tabular representation learning rely on augmentation heaps that are hard to tune. We show a negative-free criterion based on redundancy reduction matches or exceeds SimCLR-style baselines on 18 datasets while removing eight hyperparameters.',
    tag: 'A',
  },
  {
    title: 'Fault Localisation in Microservice Traces via Causal Abstraction',
    authors: 'Jonas Vandenberg',
    abstract:
      'Distributed traces are too noisy for naive root-cause ranking. We build a causal abstraction over service-call graphs and demonstrate a 31% improvement in top-3 accuracy against spectral baselines on injected-fault benchmarks.',
    tag: 'B',
  },
  {
    title: 'Privacy-Preserving Record Linkage for Multi-Site Cohort Studies',
    authors: 'Chiara Bruno, Samuel Adeyemi, Yuan Li',
    abstract:
      'Linking patient records across hospitals without revealing identifiers remains a barrier to cohort studies. We combine bloom-filter encoding with differentially private sketching, achieving 0.96 recall at a privacy budget of epsilon = 1.5.',
    tag: 'C',
  },
]

let userSeq = 0
function nextUser() {
  userSeq += 1
  const stamp = `${Date.now().toString(36)}${userSeq}`.slice(-8)
  return {
    email: `author${stamp}@example.org`,
    username: `author_${stamp}`.slice(0, 28),
    password: 'Passw0rd!demo',
  }
}

async function resetOutbox() {
  await fetch(`${API}/api/dev/email-outbox?limit=1`)
}

async function fetchOutbox(limit = 5) {
  const res = await fetch(`${API}/api/dev/email-outbox?limit=${limit}`)
  const json = await res.json()
  return json.emails ?? []
}

function extractToken(body) {
  const m = body.match(/[?&]token=([A-Za-z0-9._-]+)/) || body.match(/\b([A-Za-z0-9_-]{20,})\b/)
  return m ? m[1] : null
}

async function registerAndVerify(page, user) {
  await page.goto(`${BASE}/register`)
  await page.getByLabel('邮箱').fill(user.email)
  await page.getByLabel('用户名').fill(user.username)
  await page.getByLabel('密码', { exact: true }).fill(user.password)
  await page.getByLabel('确认密码').fill(user.password)
  await page.getByRole('button', { name: '注册' }).click()
  await page.waitForURL(/\/verify-email/, { timeout: 20000 })

  const emails = await fetchOutbox(5)
  const mine = emails.find((e) => e.to === user.email)
  if (!mine) throw new Error(`no email for ${user.email}`)
  const token = extractToken(mine.body)
  if (!token) throw new Error(`no token in body: ${mine.body.slice(0, 300)}`)

  await page.goto(`${BASE}/verify-email?token=${token}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: '验证' }).click()
  await page.getByText('邮箱验证成功，请登录').waitFor({ state: 'visible', timeout: 15000 })
}

async function login(page, creds) {
  await page.goto(`${BASE}/login`)
  await page.getByLabel('用户名或邮箱').fill(creds.username)
  await page.getByLabel('密码', { exact: true }).fill(creds.password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })
}

async function authorSubmit(page, p) {
  await page.goto(`${BASE}/submissions`)
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /新建提交/ }).click()
  await page.getByRole('dialog', { name: '新建提交' }).waitFor({ state: 'visible' })
  await page.getByLabel('标题').fill(p.title)
  await page.getByLabel('作者（逗号分隔）').fill(p.authors)
  await page.getByLabel('学科', { exact: true }).fill('computer science')
  await page.getByLabel('摘要', { exact: true }).fill(p.abstract)
  await page.getByRole('button', { name: '提交' }).click({ force: true })
  await page.getByText('提交成功，等待审核').waitFor({ state: 'visible', timeout: 10000 })
  console.log(`  [${p.tag}] submitted: ${p.title.slice(0, 50)}`)
}

// 编辑工作台是卡片式布局（不是 table），且列表按创建时间倒序（新的在前）。
// 因此统一用"操作第一个可见卡片"的方式推进：每次操作后该项会离开当前过滤
// 页签，下一个自然顶到 nth(0)，避免脆弱的文本→行配对。

async function adminAssign(page, seq) {
  await page.goto(`${BASE}/submissions/pending`)
  await page.waitForTimeout(1200)
  // 状态筛选是 Radix Tabs → role="tab"，不是 button
  await page.getByRole('tab', { name: '待分配' }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '分配审稿人' }).first().click()
  await page.locator('button[role="combobox"]').first().click()
  await page.getByRole('option', { name: /admin/ }).first().click()
  await page.getByRole('button', { name: '确认分配' }).click()
  await page.getByText('已分配审稿人').waitFor({ state: 'visible', timeout: 10000 })
  console.log(`  [assign ${seq}] ok`)
}

async function reviewerAcceptAll(page, count) {
  await page.goto(`${BASE}/review/assignments`)
  await page.waitForTimeout(1400)
  for (let i = 0; i < count; i += 1) {
    await page.getByRole('button', { name: /接受邀请/ }).first().click()
    await page.getByText('已接受审稿邀请').waitFor({ state: 'visible', timeout: 10000 })
    console.log(`  [accept ${i + 1}] ok`)
    await page.waitForTimeout(900)
  }
}

async function reviewerReport(page) {
  await page.goto(`${BASE}/review/assignments`)
  await page.waitForTimeout(1400)
  await page.getByRole('button', { name: /填写审稿报告/ }).first().click()
  await page.getByRole('heading', { name: '填写审稿报告' }).waitFor({ state: 'visible' })
  await page.locator('button[role="combobox"]').first().click()
  await page.getByRole('option', { name: '接收（Accept）' }).click()
  await page.getByLabel('给作者的意见').fill(
    'This is a well-executed study. The empirical evaluation is thorough and the ablation isolates each factor cleanly. Please clarify the sampling procedure in Section 4 and add error bars to Figure 3.',
  )
  await page.getByLabel('给编辑的保密意见（可选）').fill(
    'I recommend acceptance after minor revision. The contribution is sound and within scope. No concerns regarding methodology or ethics.',
  )
  await page.getByRole('button', { name: '提交审稿报告' }).click()
  await page.waitForTimeout(2000)
  console.log('  [report] ok')
}

async function main() {
  const browser = await chromium.launch()
  const consent = () => {}
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    window.localStorage.setItem('rubbish_cookie_consent', 'accepted')
  })

  // --- 作者 A/B/C 各自投递 ---
  const authors = []
  for (const p of PAPERS) {
    const user = nextUser()
    const page = await ctx.newPage()
    page.setDefaultTimeout(20000)
    await resetOutbox()
    await registerAndVerify(page, user)
    await login(page, user)
    await authorSubmit(page, p)
    authors.push(user)
    await page.close()
  }

  // --- admin 走编辑/审稿流程 ---
  const adminPage = await ctx.newPage()
  adminPage.setDefaultTimeout(20000)
  await login(adminPage, ADMIN)

  // B、C 各分配一次审稿人（"待分配"页签每次都会把最新的未分配项顶到首位）
  await adminAssign(adminPage, 1)
  await adminAssign(adminPage, 2)

  // 审稿人接受两条邀请
  await reviewerAcceptAll(adminPage, 2)

  // 其中一条提交审稿报告 → 变成"待编辑裁决"
  await reviewerReport(adminPage)

  // admin 自己也投一篇，否则「我的提交」在截图里是空状态
  await authorSubmit(adminPage, {
    tag: 'D',
    title: 'Tenant Isolation Patterns for Multi-Journal Publishing Platforms',
    authors: 'admin, Wei Chen',
    abstract:
      'Running several journals on one deployment only works if tenant isolation is enforced in the data path, not just the API layer. We compare row-level security, schema-per-tenant, and application-level scoping across latency, operability, and blast radius.',
  })

  console.log('流程数据已就绪（列表倒序，新的在前）：')
  console.log(`  A) ${PAPERS[0].title.slice(0, 40)} — pending 未分配`)
  console.log(`  B) ${PAPERS[1].title.slice(0, 40)} — 审稿中`)
  console.log(`  C) ${PAPERS[2].title.slice(0, 40)} — 报告已提交，待裁决`)

  await browser.close()
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
