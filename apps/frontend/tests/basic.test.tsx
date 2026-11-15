import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn utility', () => {
  it('合并多个 class 字符串', () => {
    expect(cn('px-2', 'py-1', 'text-sm')).toBe('px-2 py-1 text-sm')
  })

  it('处理条件 class', () => {
    const hidden = false
    expect(cn('base', hidden && 'hidden', 'visible')).toBe('base visible')
  })

  it('tailwind-merge 解决冲突：后者覆盖前者', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})
