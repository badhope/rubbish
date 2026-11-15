// 往目录里再补 6 篇"未读"资源。
// 前 8 篇在演示流程中被 admin 读过了，推荐引擎会排除已读项；
// 不留未读候选的话 /recommendations 只能走"最新收录"兜底，
// 看不到真实的标签匹配百分比。补上后推荐页才有说服力。
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const ADMIN = { username: 'admin', password: 'e2e_admin_pw_12345678' }

const EXTRA = [
  {
    type: 'paper',
    title: 'Sparse Autoencoders Reveal Interpretable Features in Protein Language Models',
    authors: ['Hana Iwata', 'Marcus Feld'],
    year: 2025,
    discipline: 'computer-science',
    subdiscipline: 'machine-learning',
    tags: ['machine-learning', 'interpretability', 'biology'],
    abstract:
      'We apply sparse autoencoders to protein language model activations and recover features that align with known structural motifs, enabling targeted editing of model behaviour.',
    preview: 'Sparse features recovered from protein LMs map onto secondary-structure motifs…',
  },
  {
    type: 'paper',
    title: 'Diffusion Priors for Inverse Problems in Electron Tomography',
    authors: ['Sofia Marchetti'],
    year: 2024,
    discipline: 'physics',
    subdiscipline: 'imaging',
    tags: ['imaging', 'diffusion-models', 'cryo-em'],
    abstract:
      'A conditional diffusion prior regularises the severely ill-posed reconstruction problem in electron tomography, cutting required tilt angles by half.',
    preview: 'Tomographic reconstruction with half the tilt series using a learned prior…',
  },
  {
    type: 'dataset',
    title: 'Global Soil Respiration Measurements, 1990–2024 (GRM-2024)',
    authors: ['Nadia Osei', 'Paul Renner'],
    year: 2024,
    discipline: 'environmental-science',
    subdiscipline: 'soil-science',
    tags: ['soil-carbon', 'climate', 'dataset'],
    abstract:
      'A harmonised compilation of 41,000 soil respiration chamber measurements with consistent metadata and uncertainty estimates.',
    preview: 'Forty-one thousand chamber measurements, harmonised and uncertainty-weighted…',
  },
  {
    type: 'paper',
    title: 'Causal Design Patterns for Observational Health Records',
    authors: ['Yusuf Demir', 'Lena Brandt'],
    year: 2025,
    discipline: 'statistics',
    subdiscipline: 'causal-inference',
    tags: ['causal-inference', 'biostatistics', 'study-design'],
    abstract:
      'We catalogue twelve design patterns that map common clinical questions onto identifiable causal estimands, with worked examples on electronic health records.',
    preview: 'Twelve patterns that turn clinical questions into identifiable estimands…',
  },
  {
    type: 'tutorial',
    title: 'Tokenisation-Free Sequence Models for Low-Resource Morphology',
    authors: ['Aylin Kaya'],
    year: 2026,
    discipline: 'linguistics',
    subdiscipline: 'computational-linguistics',
    tags: ['nlp', 'low-resource', 'morphology'],
    abstract:
      'Byte-level models without explicit tokenisation outperform subword baselines on eleven morphologically rich languages when training data is scarce.',
    preview: 'No tokenizer, no problem: byte-level models win when data is scarce…',
  },
  {
    type: 'paper',
    title: 'Energy-Accuracy Pareto Frontiers in On-Device Retrieval',
    authors: ['Tomás Vidal', 'Wei Zhang'],
    year: 2025,
    discipline: 'computer-science',
    subdiscipline: 'information-retrieval',
    tags: ['retrieval', 'machine-learning', 'efficiency'],
    abstract:
      'We characterise the energy-accuracy trade-off surface for on-device dense retrieval and show that a learned router dominates static configurations by 31% energy at equal recall.',
    preview: 'A learned router beats static index configurations by 31% energy at equal recall…',
  },
]

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    window.localStorage.setItem('rubbish_cookie_consent', 'accepted')
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(20000)
  await page.goto(`${BASE}/login`)
  await page.getByLabel('用户名或邮箱').fill(ADMIN.username)
  await page.getByLabel('密码', { exact: true }).fill(ADMIN.password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })

  const st = await page.evaluate(
    () =>
      sessionStorage.getItem('rubbish-auth') ||
      localStorage.getItem('rubbish-auth'),
  )
  const token = JSON.parse(st || '{}')?.state?.token

  // 幂等：先取现有标题，已存在的跳过，重复运行不会产生脏数据。
  const existing = await page.evaluate(
    async ([t]) => {
      const out = []
      for (let p = 1; p <= 5; p += 1) {
        const res = await fetch(`/api/catalog?page=${p}&page_size=20`, {
          headers: { Authorization: `Bearer ${t}` },
        })
        if (!res.ok) break
        const body = await res.json()
        out.push(...body.data.map((d) => d.title))
        if (body.meta.page >= body.meta.total_pages) break
      }
      return out
    },
    [token],
  )
  const have = new Set(existing)
  const todo = EXTRA.filter((r) => !have.has(r.title))
  if (todo.length < EXTRA.length) {
    console.log(`  跳过已存在 ${EXTRA.length - todo.length} 篇`)
  }

  let ok = 0
  for (const r of todo) {
    const out = await page.evaluate(
      async ([payload, t]) => {
        const res = await fetch('/api/catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
          body: JSON.stringify(payload),
        })
        return { status: res.status, body: await res.text() }
      },
      [r, token],
    )
    if (out.status === 200 || out.status === 201) {
      ok += 1
      console.log(`  ✓ ${r.title.slice(0, 46)}…`)
    } else {
      console.log(`  ✗ ${out.status} ${out.body.slice(0, 120)}`)
    }
  }

  await browser.close()
  console.log(`补充资源完成：${ok}/${todo.length}（总计 ${EXTRA.length}）`)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
