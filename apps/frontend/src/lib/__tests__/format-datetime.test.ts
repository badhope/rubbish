import { describe, expect, it } from 'vitest'

import { formatDateTime } from '../utils'

describe('formatDateTime timezone contract', () => {
  it('treats SQLite naive timestamps as UTC, not browser-local', () => {
    // 同一个 UTC 时刻：带 Z、带 +00:00、以及 SQLite 读出的裸时间，展示必须
    // 完全一致。否则单机部署会比生产快/慢一个时区。
    const aware = formatDateTime('2026-11-25T11:22:47.363630Z')
    expect(formatDateTime('2026-11-25T11:22:47.363630')).toBe(aware)
    expect(formatDateTime('2026-11-25T11:22:47.363630+00:00')).toBe(aware)
  })

  it('keeps empty and invalid values on the fallback', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('not-a-date')).toBe('—')
  })
})
