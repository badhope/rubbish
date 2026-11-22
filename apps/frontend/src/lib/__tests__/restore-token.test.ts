import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRestoreToken, loadRestoreToken, saveRestoreToken } from '../restore-token'

const KEY = 'rubbish-restore-token'

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

  it('keeps a pre-deletion token outside the auth store', () => {
    saveRestoreToken('old-token')
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    expect(raw.token).toBe('old-token')
    expect(raw.expires_at).toBe(Date.now() + 30 * 24 * 60 * 60 * 1000)
    expect(loadRestoreToken()).toBe('old-token')
  })

  it('expires after the 30-day deletion window', () => {
    saveRestoreToken('old-token')
    vi.setSystemTime(new Date('2026-12-23T00:00:00Z'))
    expect(loadRestoreToken()).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('ignores corrupt credentials and clears on success', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadRestoreToken()).toBeNull()
    saveRestoreToken('old-token')
    clearRestoreToken()
    expect(loadRestoreToken()).toBeNull()
  })
})
