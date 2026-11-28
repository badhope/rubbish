import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }))

import { api } from '@/lib/api'
import { preflightFailureSummary, useAdminPreflight } from '@/hooks/use-admin-preflight'

const post = api.post as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  post.mockReset()
})

describe('useAdminPreflight', () => {
  it('returns the server result and clears on reset', async () => {
    post.mockResolvedValue({ data: { status: 'fail', summary: '有硬冲突', items: [] } })
    const { result } = renderHook(() => useAdminPreflight())

    await act(async () => {
      const value = await result.current.run('member_xp', { user_id: 7, amount: 1 })
      expect(value?.status).toBe('fail')
    })

    await waitFor(() => expect(result.current.result?.summary).toBe('有硬冲突'))
    expect(result.current.checking).toBe(false)
    expect(post).toHaveBeenCalledWith('/admin/actions/preflight', {
      kind: 'member_xp',
      payload: { user_id: 7, amount: 1 },
    })

    act(() => result.current.reset())
    expect(result.current.result).toBeNull()
  })

  it('puts the first hard conflicts into a quick-action summary', () => {
    const summary = preflightFailureSummary({
      status: 'fail',
      summary: '有硬冲突，先修正再保存。',
      items: [
        { key: 'email', label: '邮箱', status: 'fail', detail: '邮箱已被 A 使用。' },
        { key: 'role', label: '角色', status: 'fail', detail: '该角色不可分配。' },
        { key: 'note', label: '备注', status: 'ok', detail: '备注已填写。' },
      ],
    })
    expect(summary).toBe('邮箱已被 A 使用。；该角色不可分配。')
  })

  it('keeps an error message when the request fails', async () => {
    post.mockRejectedValue(new Error('网络断了'))
    const { result } = renderHook(() => useAdminPreflight())

    await act(async () => {
      const value = await result.current.run('shop_item', { name: 'x' })
      expect(value).toBeNull()
    })

    await waitFor(() => expect(result.current.error).toBe('网络断了'))
    expect(result.current.result).toBeNull()
  })
})
