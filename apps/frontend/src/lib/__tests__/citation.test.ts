import { describe, expect, it } from 'vitest'
import { formatBibtex, formatCitation, formatRis } from '@/lib/citation'

const paper = {
  title: '中文标题：一个测试',
  authors: ['张三', '李四', '王五', '赵六'],
  year: 2024,
  type: 'paper' as const,
  venue: '测试学报',
  doi: '10.1000/test',
  volume: '12',
  issue: '3',
  pages: '45-58',
}

const book = {
  title: '一本测试书',
  authors: ['Alice Smith', 'Bob Jones'],
  year: 2020,
  type: 'book' as const,
  publisher: '测试出版社',
  site_id: 'R-000001-20200101-0001',
}

describe('formatCitation', () => {
  it('formats GB/T 7714 with type mark, volume/issue, pages and DOI', () => {
    const text = formatCitation(paper, 'gb-t-7714')
    expect(text).toContain('张三，李四，王五，等')
    expect(text).toContain('[J]')
    expect(text).toContain('测试学报，2024，12(3)：45-58')
    expect(text).toContain('https://doi.org/10.1000/test')
  })

  it('formats APA and MLA without losing the site id fallback', () => {
    expect(formatCitation(paper, 'apa')).toContain('(2024).')
    expect(formatCitation(paper, 'apa')).toContain('https://doi.org/10.1000/test')
    expect(formatCitation(book, 'mla')).toContain('"一本测试书."')
    expect(formatCitation(book, 'mla')).toContain('R-000001-20200101-0001')
  })

  it('formats BibTeX and RIS without empty fields', () => {
    expect(formatBibtex(paper)).toContain('@article{')
    expect(formatBibtex(paper)).toContain('doi = {10.1000/test}')
    expect(formatBibtex(book)).toContain('@book{')
    expect(formatRis(paper)).toContain('TY  - JOUR')
    expect(formatRis(paper)).toContain('SP  - 45')
    expect(formatRis(paper)).not.toContain('VL  - \n')
  })
})
