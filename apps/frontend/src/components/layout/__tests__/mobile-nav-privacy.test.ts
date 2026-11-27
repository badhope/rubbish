import { describe, expect, it } from 'vitest'
import { MOBILE_MORE } from '../mobile-nav'

describe('mobile more menu', () => {
  it('在社区分组里提供隐私政策入口', () => {
    const entries = MOBILE_MORE.filter((item) => item.to === '/privacy')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.group).toBe('社区')
    expect(entries[0]?.label).toBe('隐私政策')
  })
})
