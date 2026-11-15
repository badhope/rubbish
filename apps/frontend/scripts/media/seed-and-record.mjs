// 灌入演示数据 + 记录使用流程视频。
// 独立脚本（非 test runner），便于完全控制 viewport / 录像 / 截图时机。
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:5173'
const ADMIN = { username: 'admin', password: 'e2e_admin_pw_12345678' }
const OUT_VIDEO = '/workspace/rubbish-media/raw'
const OUT_SHOT = '/workspace/rubbish-media/screenshots'

fs.mkdirSync(OUT_VIDEO, { recursive: true })
fs.mkdirSync(OUT_SHOT, { recursive: true })

// 真实感的学术演示数据 —— 覆盖多个学科/类型，让目录页看起来像真平台
const RESOURCES = [
  {
    type: '论文',
    status: '已发表',
    title: 'Retrieval-Augmented Generation for Low-Resource Languages',
    authors: 'Amara Okafor, Chen Wei, Lucía Fernández',
    year: '2025',
    discipline: 'computer science',
    subdiscipline: '',
    abstract:
      'We present a retrieval-augmented generation framework that lifts question-answering quality on low-resource languages without parallel corpora. By aligning dense retrievers with a multilingual teacher model, our method improves answer exact-match by 11.4 points across seven languages under 10M utterances.',
    venue: 'Transactions on Machine Intelligence',
    tags: 'RAG, multilingual, retrieval',
    doi: '10.5555/tmi.2025.4418',
    volume: '12',
    issue: '3',
    pages: '211-238',
    issn: '2375-1681',
  },
  {
    type: '论文',
    status: '已发表',
    title: 'A Phase Field Model of Dendritic Growth in Ternary Alloys',
    authors: 'Hiroshi Nakamura, Elena Rossi',
    year: '2024',
    discipline: 'physics',
    subdiscipline: '',
    abstract:
      'Dendritic solidification governs the microstructure and mechanical fate of most cast alloys. This work derives a thermodynamically consistent phase field model for ternary systems and validates it against in-situ synchrotron observations of Al-Cu-Si solidification.',
    venue: 'Journal of Computational Materials Science',
    tags: 'phase field, solidification, microstructure',
    doi: '10.5555/jcms.2024.0917',
    volume: '58',
    issue: '11',
    pages: '4501-4519',
    issn: '1099-4475',
  },
  {
    type: '论文',
    status: '审稿中',
    title: 'Stochastic Soil Carbon Feedbacks Under Repeated Drought',
    authors: 'Priya Raghavan, Tom Bergqvist',
    year: '2026',
    discipline: 'environmental science',
    subdiscipline: '',
    abstract:
      'Soil carbon models disagree sharply on whether repeated droughts accelerate or attenuate carbon release. Using a 34-site synthesis and a hierarchical Bayesian treatment of measurement error, we show the sign of the feedback depends on antecedent moisture history rather than drought intensity.',
    venue: 'Global Biogeochemical Cycles',
    tags: 'soil carbon, drought, Bayesian',
    doi: '10.5555/gbc.2026.0233',
    volume: '40',
    issue: '2',
    pages: '188-204',
    issn: '0886-6236',
  },
  {
    type: '图书',
    status: '已发表',
    title: 'Statistical Inference for Sequential Experiments',
    authors: 'Marguerite Dubois',
    year: '2023',
    discipline: 'statistics',
    subdiscipline: '',
    abstract:
      'A graduate-level treatment of inference under adaptive data collection, covering always-valid confidence sequences, doubly robust off-policy evaluation, and the design of bandit experiments that survive their own stopping rules.',
    venue: 'Cambridge University Press',
    tags: 'inference, sequential design, bandits',
    doi: '',
    isbn: '978-1-108-83912-4',
    pages: '412',
  },
  {
    type: '论文',
    status: '已发表',
    title: 'Cryo-EM Structure of a Membrane Transport Intermediate',
    authors: 'Yusuf Demir, Sofia Almeida, Kang Ji-woo',
    year: '2025',
    discipline: 'biology',
    subdiscipline: '',
    abstract:
      'We report the 2.8 Å cryo-EM structure of a secondary active transporter trapped in an inward-facing occluded state, resolving a long-standing ambiguity about the alternating-access cycle and revealing a lipid-mediated hinge.',
    venue: 'Nature Structural Biology Reports',
    tags: 'cryo-EM, transporter, structural biology',
    doi: '10.5555/nsbr.2025.7712',
    volume: '31',
    issue: '7',
    pages: '902-914',
    issn: '1545-9985',
  },
  {
    type: '数据集',
    status: '已发表',
    title: 'Urban Acoustic Monitoring Corpus (UAMC-2025)',
    authors: 'Ingrid Halvorsen, Diego Salazar',
    year: '2025',
    discipline: 'computer science',
    subdiscipline: '',
    abstract:
      'UAMC-2025 contains 4,800 hours of labelled urban soundscape recordings from 12 cities, with co-registered meteorology and traffic counts. Intended as a benchmark for environmental sound classification and long-tail event detection.',
    venue: 'Rubbish Data Repository',
    tags: 'dataset, audio, benchmark',
    doi: '10.5555/uamc.2025.0004',
    external_url: 'https://example.org/uamc',
  },
  {
    type: '论文',
    status: '已发表',
    title: 'Nonlinear Mode Coupling in Rotating Detonation Engines',
    authors: 'Wei Zhang, Olga Petrova',
    year: '2024',
    discipline: 'engineering',
    subdiscipline: '',
    abstract:
      'Rotating detonation engines promise step-change efficiency for propulsion, yet their operating envelope is limited by mode instability. We derive an amplitude-equation description of coupled detonation waves and identify a stabilising injection schedule validated on a laboratory rig.',
    venue: 'Journal of Propulsion and Power',
    tags: 'detonation, combustion, nonlinear dynamics',
    doi: '10.5555/jpp.2024.3390',
    volume: '40',
    issue: '5',
    pages: '733-748',
    issn: '0748-4658',
  },
  {
    type: '论文',
    status: '已发表',
    title: 'Auditability Trade-offs in Federated Learning Deployments',
    authors: 'Nadia Haddad, Simon Bréval',
    year: '2026',
    discipline: 'computer science',
    subdiscipline: '',
    abstract:
      'Federated learning is often adopted for privacy reasons, yet its decentralised updates complicate post-hoc audit. We quantify the accuracy cost of gradient-level audit trails and propose a compressed provenance log that preserves most audit utility at 3% bandwidth overhead.',
    venue: 'Privacy Enhancing Technologies Symposium',
    tags: 'federated learning, auditability, privacy',
    doi: '10.5555/pets.2026.0162',
    volume: '2026',
    issue: '1',
    pages: '145-166',
    issn: '2474-2139',
  },
]

// Radix Select 不能靠 label 点击，需要走 trigger 测点 location;: false
async function selectByTrigger(page, labelText, optionLabel) {
  // SelectTrigger 与 Label 同级，用 Label 的 htmlFor 定位 trigger 的 role=combobox
  const triggerId = await page.evaluate((lt) => {
    const label = [...document.querySelectorAll('label')].find(
      (l) => l.textContent?.trim() === lt,
    )
    return label ? label.getAttribute('for') : null
  }, labelText)
  if (!triggerId) return false
  const trigger = page.locator(`[aria-labelledby="${triggerId}"], #${triggerId}`).first()
  await trigger.click()
  await page.getByRole('option', { name: optionLabel, exact: true }).click()
  return true
}

const isVisible = async (page, opts) => {
  try {
    await page.getByLabel(opts.label, { exact: opts.exact ?? false }).waitFor({ state: 'visible', timeout: 1500 })
    return true
  } catch {
    return false
  }
}

async function fillIfVisible(page, label, value, exact = false) {
  if (!value) return
  if (!(await isVisible(page, { label, exact }))) return
  const field = page.getByLabel(label, { exact })
  await field.fill(String(value))
}

async function createResource(page, r) {
  await page.goto(`${BASE}/catalog/new`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)

  await selectByTrigger(page, '类型', r.type)
  await selectByTrigger(page, '发表状态', r.status)

  await fillIfVisible(page, '年份', r.year, true)
  await fillIfVisible(page, '标题', r.title, true)
  await fillIfVisible(page, '作者（逗号分隔）', r.authors, true)
  await fillIfVisible(page, '学科', r.discipline, true)
  await fillIfVisible(page, '摘要', r.abstract, true)
  await fillIfVisible(page, '出版物', r.venue, true)
  await fillIfVisible(page, '标签（逗号分隔）', r.tags, true)
  await fillIfVisible(page, 'DOI', r.doi, true)
  await fillIfVisible(page, '卷', r.volume, true)
  await fillIfVisible(page, '期', r.issue, true)
  await fillIfVisible(page, '页码', r.pages, true)
  await fillIfVisible(page, 'ISSN', r.issn, true)
  await fillIfVisible(page, 'ISBN', r.isbn, true)
  await fillIfVisible(page, '外部链接', r.external_url, true)

  await page.getByRole('button', { name: /^(创建|保存|提交|Create)/ }).first().click()
  // 等待离开表单（成功会跳详情页）或出现校验错误
  await Promise.race([
    page.waitForURL(/\/catalog\/[^/]+$/, { timeout: 15000 }),
    page.locator('[role="alert"], .text-destructive').first().waitFor({ timeout: 15000 }).catch(() => {}),
  ])
  await page.waitForTimeout(400)
  console.log(`  → created: ${r.title.slice(0, 46)}  url=${new URL(page.url()).pathname}`)
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
  page.setDefaultTimeout(20000)

  console.log('=== 1. 访客浏览首页 ===')
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)

  console.log('=== 2. 登录 admin ===')
  await page.goto(`${BASE}/login`)
  await page.getByLabel('用户名或邮箱').fill(ADMIN.username)
  await page.getByLabel('密码', { exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })
  await page.waitForTimeout(1200)
  console.log(`  logged in → ${new URL(page.url()).pathname}`)

  console.log('=== 3. 创建演示资源 ===')
  for (const r of RESOURCES) {
    await createResource(page, r)
  }

  console.log('=== 4. 浏览目录 ===')
  await page.goto(`${BASE}/catalog`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  console.log('=== 5. 逐个查看详情页 ===')
  const links = await page.locator('a[href^="/catalog/"]:not([href="/catalog/new"])').evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute('href')).filter((h) => h && h !== '/catalog/new'))],
  )
  console.log(`  详情页: ${links.length} 个`)
  for (const href of links.slice(0, 4)) {
    await page.goto(`${BASE}${href}`)
    await page.waitForTimeout(1100)
  }

  console.log('=== 6. 后台管理页 ===')
  for (const p of ['/admin/users', '/admin/audit-logs', '/admin/journal', '/admin/issues']) {
    await page.goto(`${BASE}${p}`)
    await page.waitForTimeout(900)
  }

  console.log('=== 7. 投稿 / 审稿 / 阅读器 ===')
  for (const p of ['/submissions', '/submissions/pending', '/review/assignments', '/library', '/recommendations', '/notifications', '/ingest']) {
    await page.goto(`${BASE}${p}`)
    await page.waitForTimeout(900)
  }

  await page.goto(`${BASE}/dashboard`)
  await page.waitForTimeout(1200)

  console.log('=== 完成，保存录像 ===')
  await context.close() // 录像在 context 关闭时才写完
  await browser.close()

  const videos = fs.readdirSync(OUT_VIDEO).filter((f) => f.endsWith('.webm'))
  console.log('录像文件:', videos)
}

main().catch((e) => {
  console.error('FAILED:', e)
  process.exit(1)
})
