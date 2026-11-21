import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string) => readFileSync(`src/routes/${name}.tsx`, 'utf8')

describe('homepage issue information', () => {
  it('does not advertise a fixed issue in the masthead', () => {
    expect(source('index')).not.toMatch(/第\s*1\s*卷\s*·\s*第\s*1\s*期\s*·\s*2026\s*年/)
  })
})

describe('community onboarding', () => {
  it('points long-form writers to the publish wizard', () => {
    const authors = readFileSync('src/components/guide/research-guide.tsx', 'utf8')
    expect(authors).toContain('写内容')
    expect(authors).toContain('to="/submissions/new"')
    expect(authors).not.toContain('文章指南')
  })

  it('keeps the guide to four plain-language tabs', () => {
    const guide = source('guide')
    expect(guide).toContain("label: '3 分钟上手'")
    expect(guide).toContain("label: '写内容'")
    expect(guide).toContain("label: '玩讨论'")
    expect(guide).toContain("label: '规则与边界'")
  })

  it('states the site is a community, not a journal or evaluation body', () => {
    const about = source('about')
    expect(about).toContain('公开写作与讨论社区')
    expect(about).toContain('不是期刊')
    expect(about).toContain('不提供 DOI')
    expect(about).not.toContain('文章投稿')
  })
})
