import { describe, expect, it } from 'vitest'
import { translateText } from '@/lib/i18n'

describe('English copy for margins', () => {
  it('translates margin copy and leaves the quoted words alone', () => {
    expect(translateText('在页边提问', 'en')).toBe('Ask in the margin')
    expect(translateText('页边有 2 条讨论：folded a paper timetable', 'en')).toBe(
      '2 margin threads on: folded a paper timetable',
    )
    expect(translateText('页边有 1 条讨论：看了一眼', 'en')).toBe('1 margin thread on: 看了一眼')
    expect(translateText('1 条讨论贴在正文右侧的页边上', 'en')).toBe(
      '1 thread sits in the margin to the right of the text',
    )
  })

  it('counts replies with the right number', () => {
    expect(translateText('1 回应', 'en')).toBe('1 reply')
    expect(translateText('3 回应', 'en')).toBe('3 replies')
  })
})
