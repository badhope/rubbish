import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(`src/routes/${name}.tsx`, 'utf8')

describe('homepage issue information', () => {
  it('does not advertise a fixed issue in the masthead', () => {
    expect(source('index')).not.toMatch(/第\s*1\s*卷\s*·\s*第\s*1\s*期\s*·\s*2026\s*年/)
  })
})

describe('community onboarding', () => {
  it('points article writers to the submission wizard', () => {
    const authors = readFileSync('src/components/guide/research-guide.tsx', 'utf8')
    expect(authors).toContain('文章指南')
    expect(authors).toContain('to="/submissions/new"')
    expect(authors).not.toContain("to=\"/forum\"\n              写文章")
  })

  it('keeps the guide to three community tabs', () => {
    const guide = source('guide')
    expect(guide).toContain("label: '文章指南'")
    expect(guide).toContain("label: '社区指南'")
    expect(guide).toContain("label: '社区公约'")
    expect(guide).not.toContain("label: '等级与规范'")
  })

  it('describes the community as the starting point, not a journal conversion', () => {
    const about = source('about')
    expect(about).toContain('从第一天就是一个社区')
    expect(about).not.toContain('不是期刊')
    expect(about).not.toContain('停止期刊化')
  })
})
