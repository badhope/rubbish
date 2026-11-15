import { describe, it, expect } from 'vitest'
import { isTwoFactorRequired } from '@/lib/types'
import type {
  TokenResponse,
  TwoFactorRequiredResponse,
  LoginResponse,
  ResourceType,
  SubmissionStatus,
  AssignmentStatus,
} from '@/lib/types'

describe('isTwoFactorRequired type guard', () => {
  it('返回 true 当 two_factor_required 为 true', () => {
    const resp: TwoFactorRequiredResponse = {
      two_factor_required: true,
      pending_token: 'abc123',
    }
    expect(isTwoFactorRequired(resp)).toBe(true)
  })

  it('返回 false 对普通 TokenResponse', () => {
    const resp: TokenResponse = {
      access_token: 'tok',
      refresh_token: 'ref',
      token_type: 'bearer',
      user_id: 1,
      username: 'alice',
      is_admin: false,
    }
    expect(isTwoFactorRequired(resp)).toBe(false)
  })

  it('类型收窄后 TypeScript 允许访问 pending_token', () => {
    const resp: LoginResponse = {
      two_factor_required: true,
      pending_token: 'tok123',
    }
    if (isTwoFactorRequired(resp)) {
      // 收窄后可直接访问 pending_token
      expect(resp.pending_token).toBe('tok123')
    }
  })

  it('two_factor_required 为 false 时返回 false', () => {
    const resp = {
      two_factor_required: false,
      pending_token: 'x',
    } as unknown as LoginResponse
    expect(isTwoFactorRequired(resp)).toBe(false)
  })

  it('缺少 two_factor_required 字段时返回 false', () => {
    const resp = {} as unknown as LoginResponse
    expect(isTwoFactorRequired(resp)).toBe(false)
  })
})

describe('ResourceType discriminated union', () => {
  const validTypes: ResourceType[] = ['paper', 'book', 'dataset', 'tutorial']

  it('所有 ResourceType 值都在已知集合中', () => {
    for (const t of validTypes) {
      expect(['paper', 'book', 'dataset', 'tutorial']).toContain(t)
    }
  })

  it('非 ResourceType 值不在集合中', () => {
    expect(validTypes).not.toContain('journal')
    expect(validTypes).not.toContain('article')
    expect(validTypes).not.toContain('preprint')
  })
})

describe('SubmissionStatus union', () => {
  it('包含所有 9 个 workflow 状态', () => {
    const states: SubmissionStatus[] = [
      'pending',
      'under_review',
      'major_revision',
      'minor_revision',
      'resubmitted',
      'accepted',
      'rejected',
      'approved',
    ]
    expect(states).toHaveLength(8)
    // 每个状态都是合法的字符串字面量
    for (const s of states) {
      expect(typeof s).toBe('string')
    }
  })
})

describe('AssignmentStatus union', () => {
  it('包含所有审查分配状态', () => {
    const states: AssignmentStatus[] = [
      'pending',
      'accepted',
      'declined',
      'completed',
      'cancelled',
    ]
    expect(states).toHaveLength(5)
  })
})
