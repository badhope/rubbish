import { describe, expect, it } from 'vitest'
import { canDirectAcceptRevision, isRevisionSubmission } from '../revision'

describe('返修稿入口口径', () => {
  it('只有 v2+ 才算返修稿', () => {
    expect(isRevisionSubmission(1)).toBe(false)
    expect(isRevisionSubmission(undefined)).toBe(false)
    expect(isRevisionSubmission(2)).toBe(true)
    expect(isRevisionSubmission(3)).toBe(true)
  })

  it('under_review 的返修稿才允许直接录用', () => {
    expect(canDirectAcceptRevision('under_review', 2)).toBe(true)
    expect(canDirectAcceptRevision('under_review', 1)).toBe(false)
    expect(canDirectAcceptRevision('resubmitted', 2)).toBe(false)
    expect(canDirectAcceptRevision('pending', 2)).toBe(false)
    expect(canDirectAcceptRevision('accepted', 2)).toBe(false)
  })

  it('首次投稿任何状态下都不能直接录用', () => {
    expect(canDirectAcceptRevision('pending', 1)).toBe(false)
    expect(canDirectAcceptRevision('under_review', 1)).toBe(false)
    expect(canDirectAcceptRevision('resubmitted', 1)).toBe(false)
  })
})
