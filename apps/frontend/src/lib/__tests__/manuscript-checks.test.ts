import { describe, expect, it } from 'vitest'
import { checkManuscript } from '@/lib/manuscript-checks'

describe('checkManuscript', () => {
  it('reports figure/table numbering gaps and reference duplicates', () => {
    const issues = checkManuscript(`# 摘要\n摘要正文。\n\n# 关键词\n关键词。\n\n图 1 示例\n图 3 示例\n表 1 示例\n表 3 示例\n\n# 参考文献\n[1] A\n[1] B\n[3] C\n`)
    expect(issues.some((i) => i.code === '图-gap' && i.message.includes('2'))).toBe(true)
    expect(issues.some((i) => i.code === '表-gap' && i.message.includes('2'))).toBe(true)
    expect(issues.some((i) => i.code === 'reference-duplicate')).toBe(true)
    expect(issues.some((i) => i.code === '参考文献-gap' && i.message.includes('2'))).toBe(true)
  })

  it('blocks placeholders and duplicate paragraphs', () => {
    const paragraph = '这是一个足够长的段落，用来验证重复段落检查是否会命中同一段文字，而不是把短句误判为重复。'
    const issues = checkManuscript(`# 摘要\n摘要正文。\n\n# 关键词\n关键词。\n\n${paragraph}\n\n${paragraph}\n\nTODO 补实验\n`)
    expect(issues.some((i) => i.code === 'placeholder' && i.level === 'blocker')).toBe(true)
    expect(issues.some((i) => i.code === 'duplicate-paragraph')).toBe(true)
  })

  it('warns when abstract or references are missing', () => {
    const issues = checkManuscript('只有正文，没有前置概述，也没有引文清单。')
    expect(issues.some((i) => i.code === 'abstract-missing')).toBe(true)
    expect(issues.some((i) => i.code === 'references-missing')).toBe(true)
  })
})
