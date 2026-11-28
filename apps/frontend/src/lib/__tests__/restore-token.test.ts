import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRestoreToken, loadRestoreToken, saveRestoreToken } from '../restore-token'

const KEY = 'rubbish-restore-token'
const deadline = '2026-12-22T01:30:00Z'

describe('restore token', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('stores the recovery credential with the deadline from the server', () => {
    saveRestoreToken('restore-token', deadline)
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    expect(raw.token).toBe('restore-token')
    expect(raw.expires_at).toBe(Date.parse(deadline))
    expect(loadRestoreToken()).toBe('restore-token')
  })

  it('expires after the 30-day deletion window', () => {
    saveRestoreToken('restore-token', deadline)
    vi.setSystemTime(new Date(deadline))
    expect(loadRestoreToken()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('ignores corrupt credentials and clears on success', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadRestoreToken()).toBeNull()
    saveRestoreToken('restore-token', deadline)
    clearRestoreToken()
    expect(loadRestoreToken()).toBeNull()
  })
})
