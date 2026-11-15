import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '@/lib/utils'

/**
 * 开放重定向防护（P0-6）。
 *
 * `?redirect=` 完全由 URL 控制，直接喂给 router 会把"登录成功"的用户静默
 * 送到任意外部站点（钓鱼）。`safeInternalPath` 必须只放行站内相对路径。
 */
describe('safeInternalPath', () => {
  it('放行站内相对路径', () => {
    expect(safeInternalPath('/dashboard')).toBe('/dashboard')
    expect(safeInternalPath('/catalog/12')).toBe('/catalog/12')
    expect(safeInternalPath('/reader/5?page=2')).toBe('/reader/5?page=2')
  })

  it('空值回退到默认页', () => {
    expect(safeInternalPath(null)).toBe('/dashboard')
    expect(safeInternalPath(undefined)).toBe('/dashboard')
    expect(safeInternalPath('')).toBe('/dashboard')
  })

  it('拦截绝对 URL（含 http/https 与协议相对）', () => {
    expect(safeInternalPath('https://evil.example/phish')).toBe('/dashboard')
    expect(safeInternalPath('http://evil.example')).toBe('/dashboard')
    // `//evil.example` 会被浏览器当成协议相对 URL，是最容易漏的一种
    expect(safeInternalPath('//evil.example')).toBe('/dashboard')
    // 部分浏览器把 `/\evil.example` 也当外链
    expect(safeInternalPath('/\\evil.example')).toBe('/dashboard')
  })

  it('拦截 javascript: 等伪协议', () => {
    expect(safeInternalPath('javascript:alert(1)')).toBe('/dashboard')
    expect(safeInternalPath('data:text/html,<script>')).toBe('/dashboard')
  })

  it('尊重自定义 fallback', () => {
    expect(safeInternalPath('https://evil.example', '/login')).toBe('/login')
  })
})
