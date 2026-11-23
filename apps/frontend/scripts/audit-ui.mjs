/**
 * UI audit crawler for the local offline replica.
 *
 * Run from apps/frontend:
 *   node scripts/audit-ui.mjs
 *
 * It intentionally talks to a running instance (default 127.0.0.1:4180) and
 * uses the offline replica's synthetic tokens. Do not run it against
 * production: it would create a lot of traffic and try test identities.
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const BASE = process.env.AUDIT_BASE ?? 'http://127.0.0.1:4180'
const OUT = resolve(
  process.env.AUDIT_OUT ??
    '/home/user/Doubao/chats/38453955553907202/rubbish-remediation/d10-offline/evidence/audit-20261124/ui-audit.json',
)
const SCREENSHOT_DIR = resolve(dirname(OUT), 'ui-audit-shots')
mkdirSync(SCREENSHOT_DIR, { recursive: true })

const ROUTES = [
  { path: '/', token: null },
  { path: '/catalog', token: null },
  { path: '/catalog?track=paper', token: null },
  { path: '/catalog?track=essay', token: null },
  { path: '/catalog?discipline=生命科学', token: null },
  { path: '/catalog?sort=latest', token: null },
  { path: '/catalog/304', token: null },
  { path: '/issues', token: null },
  { path: '/forum', token: null },
  { path: '/forum/topic/22', token: null },
  { path: '/guide', token: null },
  { path: '/about', token: null },
  { path: '/privacy', token: null },
  { path: '/accessibility', token: null },
  { path: '/tags', token: null },
  { path: '/status', token: null },
  { path: '/search', token: null },
  { path: '/search?q=时间', token: null },
  { path: '/levels', token: null },
  { path: '/login', token: null, auth: true },
  { path: '/register', token: null, auth: true },
  { path: '/forgot-password', token: null, auth: true },
  { path: '/reset-password', token: null, auth: true },
  { path: '/verify-email', token: null, auth: true },
  { path: '/restore-account', token: null, auth: true },
  { path: '/403', token: null },
  { path: '/me', token: 'offline-admin' },
  { path: '/me?tab=library', token: 'offline-admin' },
  { path: '/me?tab=points', token: 'offline-admin' },
  { path: '/me?tab=settings', token: 'offline-admin' },
  { path: '/submissions', token: 'offline-author' },
  { path: '/submissions/pending', token: 'offline-editor' },
  { path: '/editor/calibration', token: 'offline-editor' },
  { path: '/editor/issue-plan', token: 'offline-editor' },
  { path: '/review', token: 'offline-reviewer' },
  { path: '/submissions/new', token: 'offline-author' },
  { path: '/admin', token: 'offline-admin' },
  { path: '/admin/content', token: 'offline-admin' },
  { path: '/admin/people', token: 'offline-admin' },
  { path: '/admin/economy', token: 'offline-admin' },
  { path: '/admin/system', token: 'offline-admin' },
  { path: '/u/offline_admin', token: 'offline-admin' },
  { path: '/library/1', token: 'offline-admin' },
]

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
]

const AUTH_STORAGE_KEY = 'rubbish-auth'
const BAD_TEXT = ['Invalid Date', 'undefined', 'NaN', '页面加载失败']

const browser = await chromium.launch({ headless: true })
const results = []

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
  })
  const page = await context.newPage()
  page._auditConsoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') page._auditConsoleErrors.push(msg.text())
  })

  for (const route of ROUTES) {
    page._auditConsoleErrors = []
    let status = null
    let error = null
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      await page.evaluate(
        ({ key, token }) => {
          if (token) sessionStorage.setItem(key, JSON.stringify({ state: { token }, version: 0 }))
          else sessionStorage.removeItem(key)
        },
        { key: AUTH_STORAGE_KEY, token: route.token },
      )
      const response = await page.goto(`${BASE}${route.path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      })
      status = response?.status() ?? null
      await page.waitForTimeout(900)
    } catch (err) {
      error = String(err)
    }

    const data = await page.evaluate((badText) => {
      const vw = document.documentElement.clientWidth
      const headings = [...document.querySelectorAll('h1')]
        .map((h) => (h.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
      const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ')
      const fixedTour = [...document.querySelectorAll('a,button')].find((el) =>
        (el.textContent || '').includes('新手指引'),
      )
      return {
        title: document.title,
        finalUrl: location.href,
        bodyScrollWidth: document.documentElement.scrollWidth,
        clientWidth: vw,
        horizontalOverflow: document.documentElement.scrollWidth > vw + 2,
        headings,
        duplicateH1: headings.length > 1,
        badText: badText.filter((needle) => bodyText.includes(needle)),
        textLength: bodyText.length,
        hasTourChip: Boolean(fixedTour),
        tourRect: fixedTour
          ? {
              right: Math.round(fixedTour.getBoundingClientRect().right),
              bottom: Math.round(fixedTour.getBoundingClientRect().bottom),
            }
          : null,
      }
    }, BAD_TEXT)

    const issues = []
    if (error) issues.push(`navigation: ${error}`)
    if (data.horizontalOverflow) issues.push(`horizontal overflow ${data.bodyScrollWidth}/${data.clientWidth}`)
    if (data.headings.length === 0) issues.push('missing h1')
    if (data.duplicateH1) issues.push(`duplicate h1: ${data.headings.join(' | ')}`)
    if (data.badText.length) issues.push(`bad text: ${data.badText.join(', ')}`)
    if (data.textLength < 80) issues.push(`near-empty body (${data.textLength})`)

    const record = {
      viewport: viewport.name,
      route: route.path,
      status,
      ...data,
      consoleErrors: page._auditConsoleErrors.slice(0, 5),
      issues,
    }
    results.push(record)

    if (issues.length) {
      const safeName = `${viewport.name}-${route.path.replace(/[^a-z0-9]+/gi, '_').replace(/_+/, '_')}`
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${safeName}.png`,
        fullPage: true,
      })
    }
  }
  await context.close()
}

await browser.close()
writeFileSync(OUT, JSON.stringify({ base: BASE, generatedAt: new Date().toISOString(), results }, null, 2))
const flagged = results.filter((r) => r.issues.length > 0)
console.log(`audit ${results.length} page/viewport pairs, ${flagged.length} flagged`)
for (const item of flagged) {
  console.log(`${item.viewport} ${item.route} -> ${item.issues.join('; ')}`)
}
console.log(`report: ${OUT}`)
