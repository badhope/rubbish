/**
 * Site language: Chinese source copy with a curated English layer.
 *
 * UI chrome is hand-translated. Author-written articles, thread bodies and
 * comments stay in their original language and are marked `data-i18n-skip`
 * at the render boundary.
 */
import { useEffect, useState } from 'react'
import { BRAND_EN, NAV_EN, TEXT_EN, ZH_EN } from '@/lib/i18n-dictionary'

export type Lang = 'zh' | 'en'

const KEY = 'rubbish.lang'
const EVENT = 'rubbish:lang'

function normalizeLang(value: string | null | undefined): Lang | null {
  if (value === 'en' || value === 'en-US' || value === 'en-GB') return 'en'
  if (value === 'zh' || value === 'zh-CN' || value === 'zh-Hans') return 'zh'
  return null
}

function browserPrefersEnglish(): boolean {
  if (typeof navigator === 'undefined') return false
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return languages.some((value) => value.toLowerCase().startsWith('en'))
}

function readInitialLang(): Lang {
  if (typeof window === 'undefined') return 'zh'
  const fromUrl = normalizeLang(new URL(window.location.href).searchParams.get('lang'))
  if (fromUrl) return fromUrl
  const stored = normalizeLang(window.localStorage.getItem(KEY))
  if (stored) return stored
  // An English browser lands on the English edition; a Chinese browser stays
  // on the source copy. The choice is remembered after the first click.
  return browserPrefersEnglish() ? 'en' : 'zh'
}

let currentLang: Lang = readInitialLang()

function applyDocumentLang(lang: Lang) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  document.documentElement.dataset.lang = lang
}

/** Call once before React renders so `html lang` matches the first frame. */
export function initLang(): Lang {
  applyDocumentLang(currentLang)
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(KEY, currentLang)
  }
  return currentLang
}

export function getLang(): Lang {
  return currentLang
}

export function setLang(lang: Lang): void {
  if (typeof window === 'undefined') return
  currentLang = lang
  window.localStorage.setItem(KEY, lang)
  applyDocumentLang(lang)
  // A language-bearing URL is useful when sharing a page with an English reader.
  try {
    const url = new URL(window.location.href)
    if (lang === 'en') url.searchParams.set('lang', 'en')
    else url.searchParams.delete('lang')
    window.history.replaceState(window.history.state, '', url)
  } catch {
    // Non-browser environments do not need URL state.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: lang }))
}

export function useLang(): Lang {
  const [lang, set] = useState<Lang>(currentLang)
  useEffect(() => {
    const onChange = () => set(getLang())
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [])
  return lang
}

export function navLabel(to: string, zh: string, lang: Lang = getLang()): string {
  return lang === 'en' ? (NAV_EN[to] ?? translateText(zh, lang)) : zh
}

export function groupLabel(zh: string, lang: Lang = getLang()): string {
  return lang === 'en' ? (TEXT_EN[zh] ?? translateText(zh, lang)) : zh
}

export function text(key: string, lang: Lang = getLang()): string {
  return lang === 'en' ? (TEXT_EN[key] ?? translateText(key, lang)) : key
}

export function brand(textZh: string, lang: Lang = getLang()): string {
  return lang === 'en' ? (BRAND_EN[textZh] ?? translateText(textZh, lang)) : textZh
}

const MONTHS_EN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function enMonth(value: string): string {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 12 ? MONTHS_EN[n - 1] : value
}

function replacePatterns(source: string): string {
  return source
    // Full date: 2026年11月24日 / 2026 年 11 月 24 日
    .replace(
      /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g,
      (_m, y, mo, d) => `${enMonth(mo)} ${Number(d)}, ${y}`,
    )
    // Short date: 11月24日
    .replace(
      /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g,
      (_m, mo, d) => `${enMonth(mo)} ${Number(d)}`,
    )
    // Year-month: 2026 年 10 月
    .replace(/(\d{4})\s*年\s*(\d{1,2})\s*月/g, (_m, y, mo) => `${enMonth(mo)} ${y}`)
    // Relative time
    .replace(/(\d+)\s*分钟前/g, '$1 min ago')
    .replace(/(\d+)\s*小时前/g, '$1 hr ago')
    .replace(/(\d+)\s*天前/g, '$1 days ago')
    .replace(/(\d+)\s*秒前/g, '$1 sec ago')
    .replace(/(\d+)\s*分钟/g, '$1 min')
    .replace(/(\d+)\s*小时/g, '$1 hr')
    .replace(/(\d+)\s*天/g, '$1 days')
    // Counts
    .replace(/现在有\s*(\d+)\s*卷、\s*(\d+)\s*个合集、\s*(\d+)\s*篇。/g, 'Right now: $1 volumes, $2 collections, $3 pieces.')
    .replace(/命中\s*(\d+)\s*条/g, '$1 hits')
    .replace(/全站公开文字中检索“(.+)”，命中\s*(\d+)\s*条。/g, 'Searching all public writing for “$1”: $2 hits.')
    .replace(/合集\s*(\d+)\s*共\s*(\d+)\s*篇作品，按发布顺序排列。/g, 'Collection $1: $2 works, in publishing order.')
    .replace(/第\s*(\d+)\s*卷/g, 'Volume $1')
    .replace(/共\s*(\d+)\s*篇作品/g, '$1 works')
    .replace(/共\s*(\d+)\s*条/g, '$1 items')
    .replace(/共\s*(\d+)\s*人/g, '$1 people')
    .replace(/共\s*(\d+)\s*篇/g, '$1 pieces')
    // Request failures with a status code (built at runtime in lib/api.ts)
    .replace(/服务端返回\s*(\d+)，这次请求没有完成。/g, 'Server returned $1; this request did not complete.')
    .replace(/请求没有完成（HTTP\s*(\d+)）。/g, 'Request failed (HTTP $1).')
    .replace(/(\d+)\s*篇作品/g, '$1 works')
    .replace(/(\d+)\s*条投稿记录/g, '$1 submissions')
    .replace(/(\d+)\s*条回应/g, '$1 replies')
    .replace(/(\d+)\s*条评论/g, '$1 comments')
    .replace(/(\d+)\s*条未读/g, '$1 unread')
    .replace(/(\d+)\s*个话题/g, '$1 topics')
    .replace(/(\d+)\s*个合集/g, '$1 collections')
    .replace(/(\d+)\s*个标签/g, '$1 tags')
    .replace(/^…\s*篇\s*→?$/g, '… works →')
    .replace(/^(\d+)\s*篇\s*→?$/g, '$1 works →')
    // Resend countdown
    .replace(/(\d+)\s*s\s*后重发/g, 'Resend in $1s')
    // Reading controls
    .replace(/^回复 @(.+)$/g, 'Reply to @$1')
    .replace(/^正文\s*(\d+)\s*字\s*·\s*保存后立即对外可见$/g, 'Body: $1 characters · visible as soon as you save')
    .replace(/^讨论\s*·\s*(\d+)$/g, 'Discuss · $1')
    .replace(/^楼层互动（(\d+)）$/g, 'Replies ($1)')
    .replace(/^楼层互动\((\d+)\)$/g, 'Replies ($1)')
    // Paging
    .replace(/第\s*(\d+)\s*页\s*\/\s*共\s*(\d+)\s*页/g, 'Page $1 of $2')
    .replace(/第\s*(\d+)\s*页/g, 'Page $1')
    .replace(/共\s*(\d+)\s*页/g, '$1 pages')
    // Peer review rounds / anonymous labels
    .replace(/^第\s*(\d+)\s*轮$/g, 'Round $1')
    .replace(/^匿名审稿人\s*(\d+)$/g, 'Anonymous reviewer $1')
    // Status captions
    .replace(/(\d+)\s*项待补/g, '$1 to fix')
    .replace(/(\d+)\s*项未完成/g, '$1 unfinished')
    .replace(/(\d+)\s*个阻断项待处理/g, '$1 blockers')
    .replace(/·\s*完成/g, '· completed')
    .replace(/·\s*截止/g, '· due')
    .replace(/·\s*阅读/g, '· read')
}

/**
 * Translate one rendered string. Exact dictionary first; then dates, counts
 * and relative-time patterns. Missing strings stay in Chinese rather than
 * being fed through a phrase blender — half-translated sentences read worse
 * than an honest original.
 */
export function translateText(input: string, lang: Lang = getLang()): string {
  if (lang !== 'en') return input
  const leading = input.match(/^\s*/)?.[0] ?? ''
  const trailing = input.match(/\s*$/)?.[0] ?? ''
  const normalized = input.replace(/\s+/g, ' ').trim()
  if (!normalized) return input
  const exact = ZH_EN[normalized]
  if (exact) return leading + exact + trailing
  if (/^Rubbish\b/.test(normalized) && !/[\u4e00-\u9fff]/.test(normalized)) return normalized
  const patterned = replacePatterns(normalized)
  if (patterned !== normalized) return leading + patterned + trailing
  return input
}

export function hasChinese(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value)
}

export { EVENT as LANG_EVENT, KEY as LANG_STORAGE_KEY }
