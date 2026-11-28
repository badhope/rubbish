import { describe, expect, it } from 'vitest'

import { auditActionLabel } from '../audit-labels'

describe('auditActionLabel', () => {
  it('maps the 1.20.17 area update action to a readable label', () => {
    expect(auditActionLabel('user.update_areas')).toBe('成员 · 领域资料')
  })
})
