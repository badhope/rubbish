import { describe, expect, it } from 'vitest'
import {
  languageLabel,
  recommendationReason,
  statusLabel,
  typeLabel,
} from '@/lib/resource-labels'

describe('resource label helpers', () => {
  it('maps ISO language codes to Chinese labels', () => {
    expect(languageLabel('zh')).toBe('中文')
    expect(languageLabel('EN')).toBe('英文')
    expect(languageLabel(null)).toBe('—')
    expect(languageLabel('xx')).toBe('xx')
  })

  it('maps resource types and statuses', () => {
    expect(typeLabel('paper')).toBe('论文')
    expect(typeLabel('dataset')).toBe('数据集')
    expect(statusLabel('in_review')).toBe('评审中')
    expect(statusLabel(undefined)).toBe('—')
  })

  it('rewrites fallback recommendation reasons', () => {
    expect(recommendationReason('no reading history; showing latest')).toBe('最新收录')
    expect(recommendationReason('you have read everything; showing latest')).toBe(
      '你已读完现有全部文章',
    )
  })

  it('rewrites match reasons with concrete values', () => {
    expect(recommendationReason("matches 2 tags: ['rls', 'postgres']")).toBe(
      '匹配标签：rls、postgres',
    )
    expect(recommendationReason("discipline 'computer-science'")).toBe(
      '学科匹配：computer-science',
    )
    expect(recommendationReason('no direct match')).toBe('相关领域新作')
  })
})
