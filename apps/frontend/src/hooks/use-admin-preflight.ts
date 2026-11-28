import { useCallback, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { AdminPreflightResponse } from '@/lib/types'

/**
 * Shared preflight runner for admin forms. It returns the same
 * AdminPreflightResponse shape as the content-specific endpoints, so pages can
 * reuse PreflightResults and decide whether to block the real write.
 */
export function useAdminPreflight() {
  const [result, setResult] = useState<AdminPreflightResponse | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const requestSeq = useRef(0)

  const reset = useCallback(() => {
    // 让还在路上的旧请求作废，避免它回来后覆盖刚清空的面板。
    requestSeq.current += 1
    setChecking(false)
    setResult(null)
    setError('')
  }, [])

  const run = useCallback(async (kind: string, payload: Record<string, unknown>) => {
    const mine = requestSeq.current + 1
    requestSeq.current = mine
    setChecking(true)
    setError('')
    setResult(null)
    try {
      const response = await api.post<AdminPreflightResponse>('/admin/actions/preflight', {
        kind,
        payload,
      })
      if (mine !== requestSeq.current) return null
      setResult(response.data)
      return response.data
    } catch (err) {
      if (mine !== requestSeq.current) return null
      const message = err instanceof Error ? err.message : '检查没有完成，可再试一次。'
      setError(message)
      return null
    } finally {
      if (mine === requestSeq.current) setChecking(false)
    }
  }, [])

  return { result, checking, error, run, reset }
}


/** Quick actions have no room for the full panel; surface the first hard
 * conflicts in the lightweight toast instead of a bare "有硬冲突". */
export function preflightFailureSummary(check: AdminPreflightResponse | null): string {
  if (!check) return ''
  const failures = check.items.filter((item) => item.status === 'fail')
  if (failures.length === 0) return check.summary
  return failures.slice(0, 2).map((item) => item.detail).join('；')
}
