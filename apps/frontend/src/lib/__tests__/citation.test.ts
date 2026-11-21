import { describe, expect, it } from 'vitest'
import { formatSiteCitation } from '@/lib/citation'

const paper = {
  title: '中文标题：一个测试',
  authors: ['张三', '李四', '王五', '赵六'],
  year: 2024,
  site_id: 'R-000001-20240101-0001',
}

const untitled = {
  title: '',
  authors: [],
  year: 0,
  site_id: '',
}

describe('formatSiteCitation', () => {
  it('labels the text as an in-site note, not a formal citation', () => {
    const text = formatSiteCitation(paper)
    expect(text).toContain('站内标注：张三、李四、王五 等')
    expect(text).toContain('《中文标题：一个测试》')
    expect(text).toContain('Rubbish 社区，2024')
    expect(text).toContain('站内编号 R-000001-20240101-0001')
    expect(text).toContain('不是正式引用')
  })

  it('never emits journal-style formats or DOI metadata', () => {
    const text = formatSiteCitation(paper)
    expect(text).not.toContain('GB/T')
    expect(text).not.toContain('[J]')
    expect(text).not.toContain('doi.org')
    expect(text).not.toContain('@article')
    expect(text).not.toContain('TY  - JOUR')
  })

  it('falls back to plain placeholders instead of inventing metadata', () => {
    expect(formatSiteCitation(untitled)).toContain('未署名')
    expect(formatSiteCitation(untitled)).toContain('《无题》')
    expect(formatSiteCitation(untitled)).not.toContain('站内编号')
  })
})
