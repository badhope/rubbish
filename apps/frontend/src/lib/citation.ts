import type { ResourceResponse } from '@/lib/types'

export type CitationStyle = 'gb-t-7714' | 'apa' | 'mla'

export type CitationResource = Pick<
  ResourceResponse,
  'title' | 'authors' | 'year' | 'type' | 'venue' | 'publisher' | 'doi' | 'volume' | 'issue' | 'pages' | 'external_url' | 'site_id'
>

const TYPE_MARK: Record<string, string> = {
  paper: 'J',
  book: 'M',
  dataset: 'DS',
  tutorial: 'EB/OL',
}

function clean(value?: string | null): string {
  return (value ?? '').trim()
}

function authorList(authors: string[]): string[] {
  return authors.map((a) => a.trim()).filter(Boolean)
}

function gbtAuthors(authors: string[]): string {
  const names = authorList(authors)
  if (!names.length) return '佚名'
  return names.slice(0, 3).join('，') + (names.length > 3 ? '，等' : '')
}

function gbtType(type: string): string {
  return TYPE_MARK[type] ?? 'Z'
}

function gbtSource(resource: CitationResource): string {
  const venue = clean(resource.venue) || clean(resource.publisher)
  if (!venue) return ''
  const year = resource.year ? String(resource.year) : ''
  const vol = clean(resource.volume)
  const issue = clean(resource.issue)
  const pages = clean(resource.pages)
  const volIssue = [vol, issue ? `(${issue})` : ''].filter(Boolean).join('')
  return `${venue}${year ? `，${year}` : ''}${volIssue ? `，${volIssue}` : ''}${pages ? `：${pages}` : ''}．`
}

function apaAuthors(authors: string[]): string {
  const names = authorList(authors)
  if (!names.length) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]}, & ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`
}

function apaSource(resource: CitationResource): string {
  const venue = clean(resource.venue) || clean(resource.publisher)
  if (!venue) return ''
  const year = resource.year ? String(resource.year) : ''
  const vol = clean(resource.volume)
  const issue = clean(resource.issue)
  const pages = clean(resource.pages)
  const volIssue = [vol, issue ? `(${issue})` : ''].filter(Boolean).join('')
  return `${venue}${year ? `, ${year}` : ''}${volIssue ? `, ${volIssue}` : ''}${pages ? `, ${pages}` : ''}.`
}

function mlaAuthors(authors: string[]): string {
  const names = authorList(authors)
  if (!names.length) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]}, and ${names[1]}`
  return `${names[0]}, et al`
}

function tail(resource: CitationResource): string {
  const doi = clean(resource.doi)
  if (doi) return `https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//i, '')}`
  return clean(resource.external_url) || clean(resource.site_id) || ''
}

/**
 * 轻量引用生成：不引入 CSL 引擎，先覆盖站内最常用的三种。
 * 作者名保持用户录入的原始顺序，不擅自把中文姓名拆成姓/名。
 */
export function formatCitation(resource: CitationResource, style: CitationStyle): string {
  const title = clean(resource.title) || '无题'
  const year = resource.year ? String(resource.year) : ''
  const typeMark = gbtType(resource.type)
  const source = gbtSource(resource)
  const suffix = tail(resource)

  if (style === 'apa') {
    const authors = apaAuthors(resource.authors)
    const apa = [
      authors ? `${authors}` : '',
      year ? `(${year}).` : '',
      `${title}.`,
      apaSource(resource),
      suffix,
    ].filter(Boolean).join(' ')
    return apa.replace(/\s+/g, ' ').trim()
  }

  if (style === 'mla') {
    const authors = mlaAuthors(resource.authors)
    const venue = clean(resource.venue) || clean(resource.publisher)
    const pages = clean(resource.pages) ? `pp. ${clean(resource.pages)}.` : ''
    return [
      authors ? `${authors}.` : '',
      `"${title}."`,
      venue ? `${venue},` : '',
      year ? `${year},` : '',
      pages,
      suffix,
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  }

  return `${gbtAuthors(resource.authors)}：${title}[${typeMark}]．${source}${suffix ? ` ${suffix}` : ''}`.trim()
}

// --- 学术工具页使用的 BibTeX / RIS 导出 ---

function bibKey(resource: CitationResource): string {
  const first = authorList(resource.authors)[0] ?? 'anon'
  const surname = first.includes(',') ? first.split(',')[0].trim() : first.split(/\s+/).pop() || 'anon'
  const word =
    clean(resource.title)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)[0] ?? 'untitled'
  return `${surname}${resource.year || 'nd'}${word}`.replace(/[^\p{L}\p{N}]+/gu, '')
}

function bibType(type: string): string {
  if (type === 'book') return 'book'
  if (type === 'dataset') return 'misc'
  return 'article'
}

/** 单条 BibTeX；字段只写有值的项，避免生成空字段。 */
export function formatBibtex(resource: CitationResource): string {
  const authors = authorList(resource.authors).join(' and ')
  const fields: [string, string][] = [
    ['title', clean(resource.title)],
    ['author', authors],
    ['year', resource.year ? String(resource.year) : ''],
    ['journal', clean(resource.venue) || clean(resource.publisher)],
    ['volume', clean(resource.volume)],
    ['number', clean(resource.issue)],
    ['pages', clean(resource.pages)],
    ['doi', clean(resource.doi).replace(/^https?:\/\/doi\.org\//i, '')],
    ['url', clean(resource.external_url) || (clean(resource.site_id) ? `${clean(resource.site_id)}` : '')],
  ]
  return `@${bibType(resource.type)}{${bibKey(resource)},\n${fields
    .filter(([, value]) => value)
    .map(([key, value]) => `  ${key} = {${value.replace(/[{}]/g, '')}}`)
    .join(',\n')}\n}`
}

/** 单条 RIS；每条 tag 只占一行，换行会拆坏记录。 */
export function formatRis(resource: CitationResource): string {
  const type = resource.type === 'book' ? 'BOOK' : resource.type === 'dataset' ? 'DATA' : 'JOUR'
  const pages = clean(resource.pages).split('-')
  const lines = [
    `TY  - ${type}`,
    ...authorList(resource.authors).map((name) => `AU  - ${name}`),
    `TI  - ${clean(resource.title)}`,
    `JO  - ${clean(resource.venue) || clean(resource.publisher)}`,
    `PY  - ${resource.year ? String(resource.year) : ''}`,
    `VL  - ${clean(resource.volume)}`,
    `IS  - ${clean(resource.issue)}`,
    `SP  - ${pages[0] ?? ''}`,
    `EP  - ${pages[1] ?? ''}`,
    `DO  - ${clean(resource.doi).replace(/^https?:\/\/doi\.org\//i, '')}`,
    `UR  - ${clean(resource.external_url) || clean(resource.site_id)}`,
    'ER  -',
  ]
  return lines.filter((line) => !line.endsWith('  - ')).join('\n')
}
