import { describe, it, expect } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { extractError } from '@/lib/utils'

describe('extractError', () => {
  it('AxiosError 带 detail 时返回 detail', () => {
    const err = new AxiosError(
      'Request failed',
      AxiosError.ERR_BAD_REQUEST,
      undefined,
      undefined,
      {
        data: { detail: '邮箱已被占用' },
        status: 409,
        statusText: 'Conflict',
        headers: {},
        config: { headers: new AxiosHeaders() } as InternalAxiosRequestConfig,
      } as AxiosResponse,
    )
    expect(extractError(err, '默认')).toBe('邮箱已被占用')
  })

  it('AxiosError 无 detail 时回退到 fallback', () => {
    const err = new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST)
    expect(extractError(err, '默认')).toBe('默认')
  })

  it('非 AxiosError 直接返回 fallback', () => {
    expect(extractError(new Error('boom'), '默认')).toBe('默认')
    expect(extractError('字符串错误', '默认')).toBe('默认')
    expect(extractError(null, '默认')).toBe('默认')
  })
})
