import type { ResourceResponse } from '@/lib/types'

export type CitationResource = Pick<ResourceResponse, 'title' | 'authors' | 'year' | 'site_id'>

function clean(value?: string | null): string {
  return (value ?? '').trim()
}

function names(authors: string[]): string {
  const list = authors.map((a) => a.trim()).filter(Boolean)
  if (!list.length) return '未署名'
  return list.slice(0, 3).join('、') + (list.length > 3 ? ' 等' : '')
}

/**
 * 站内标注：只用于在主题论坛、聊天或站外提到一条站内内容。
 *
 * 刻意不生成 GB/T 7714、APA、MLA、BibTeX、RIS，也不嵌入卷期、页码或 DOI：
 * Rubbish 不是期刊或出版机构，这些格式会被误读成正式学术引用。
 */
export function formatSiteCitation(resource: CitationResource): string {
  const title = clean(resource.title) || '无题'
  const year = resource.year ? String(resource.year) : ''
  const siteId = clean(resource.site_id)
  const parts = [
    `站内标注：${names(resource.authors)}，《${title}》`,
    'Rubbish 社区',
    year,
  ].filter(Boolean)
  return `${parts.join('，')}${siteId ? `。站内编号 ${siteId}` : ''}。不是正式引用。`
}
