import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Sentry from '@sentry/react'

// Sentry SDK 是动态 import 的，mock 掉才能断言"配置了 DSN 才接入"这条分支，
// 同时避免测试真的往 Sentry 发请求。
vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}))

/**
 * monitoring.ts 的 reporter 是模块级可变状态，各用例之间会互相污染。
 * 每个用例都重新 import 一份干净模块，避免"默认 console reporter"被前一个用例换掉。
 */
async function freshMonitoring() {
  vi.resetModules()
  return import('@/lib/monitoring')
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('reportError', () => {
  it('未接入监控后端时默认打到 console.error', async () => {
    const { reportError } = await freshMonitoring()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('boom')

    reportError(err, { source: 'test' })

    expect(spy).toHaveBeenCalledWith('[rubbish] unhandled error', err, { source: 'test' })
    spy.mockRestore()
  })

  it('setReporter 可以换成自定义上报实现', async () => {
    const { reportError, setReporter } = await freshMonitoring()
    const seen: Array<[unknown, unknown]> = []
    setReporter((error, context) => seen.push([error, context]))

    reportError('oops', { componentStack: '<App/>' })

    expect(seen).toEqual([['oops', { componentStack: '<App/>' }]])
  })

  it('上报实现自己抛错时不能冒泡（否则错误边界会二次崩溃）', async () => {
    const { reportError, setReporter } = await freshMonitoring()
    setReporter(() => {
      throw new Error('reporter died')
    })

    expect(() => reportError(new Error('original'))).not.toThrow()
  })
})

describe('installGlobalErrorHandlers', () => {
  it('兜底捕获同步异常与未处理的 Promise 拒绝', async () => {
    const { installGlobalErrorHandlers, setReporter } = await freshMonitoring()
    const seen: Array<{ error: unknown; source: unknown }> = []
    setReporter((error, context) => {
      seen.push({ error, source: context?.source })
    })

    installGlobalErrorHandlers()

    window.dispatchEvent(Object.assign(new Event('error'), { error: new Error('sync boom') }))
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), { reason: new Error('async boom') }),
    )

    expect(seen.map((s) => (s.error as Error).message)).toEqual(['sync boom', 'async boom'])
    expect(seen.map((s) => s.source)).toEqual(['window.onerror', 'unhandledrejection'])
  })

  it('error 事件没有 error 对象时回退到 message', async () => {
    const { installGlobalErrorHandlers, setReporter } = await freshMonitoring()
    const seen: unknown[] = []
    setReporter((error) => seen.push(error))

    installGlobalErrorHandlers()
    window.dispatchEvent(Object.assign(new Event('error'), { message: 'Script error.' }))

    expect(seen).toEqual(['Script error.'])
  })
})

describe('initMonitoring', () => {
  it('未配置 VITE_SENTRY_DSN 时是 no-op，不加载 Sentry SDK', async () => {
    const { initMonitoring } = await freshMonitoring()

    await initMonitoring()

    expect(Sentry.init).not.toHaveBeenCalled()
  })

  it('配置了 DSN 时接入 Sentry，并把 reportError 转接到 captureException', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://abc123@o0.ingest.sentry.io/1')
    const { initMonitoring, reportError } = await freshMonitoring()

    await initMonitoring()
    const err = new Error('production boom')
    reportError(err, { componentStack: '<Reader/>' })

    expect(Sentry.init).toHaveBeenCalledOnce()
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      extra: { componentStack: '<Reader/>' },
    })
  })
})
