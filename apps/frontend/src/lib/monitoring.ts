/**
 * 前端错误上报的统一入口。
 *
 * 这里只定义"上报"这一件事的抽象，具体后端（Sentry / 自建接口 / 纯 console）
 * 由 `initMonitoring()` 在启动时决定。业务代码一律只 import `reportError`，
 * 换监控方案时不需要动任何调用点。
 */

export interface ErrorContext {
  /** React 组件栈（来自 ErrorBoundary 的 info.componentStack） */
  componentStack?: string
  /** 任意附加标签，会作为结构化上下文一起上报 */
  [key: string]: unknown
}

type Reporter = (error: unknown, context?: ErrorContext) => void

const consoleReporter: Reporter = (error, context) => {
  // 开发期直接打到控制台；生产环境若未配置监控后端，也至少留下痕迹
  console.error('[rubbish] unhandled error', error, context ?? {})
}

let reporter: Reporter = consoleReporter

/** 供监控后端注册自己的上报实现（如 Sentry.captureException）。 */
export function setReporter(next: Reporter): void {
  reporter = next
}

/** 业务代码/错误边界统一调用这个函数上报错误。 */
export function reportError(error: unknown, context?: ErrorContext): void {
  try {
    reporter(error, context)
  } catch {
    // 上报本身失败绝不能再抛出，否则会在错误边界里造成二次崩溃
  }
}

/**
 * 兜底捕获两类逃逸出 React 的错误：
 * - `window.onerror`：同步异常
 * - `unhandledrejection`：未 catch 的 Promise
 *
 * ErrorBoundary 只能捕获渲染期错误，事件回调 / 异步任务里的异常都到不了它那儿。
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, { source: 'window.onerror' })
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { source: 'unhandledrejection' })
  })
}

/**
 * 初始化监控后端。
 *
 * - 未配置 `VITE_SENTRY_DSN` 时是 no-op（默认 console reporter 继续生效），
 *   开源用户不配置也零成本。
 * - 配置后动态 import @sentry/react —— Sentry SDK 不进主 bundle，
 *   只有真的启用了监控才会多加载这一份代码。
 */
export async function initMonitoring(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return

  try {
    const Sentry = await import('@sentry/react')
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // 浏览器端 tracing 采样率保守取 10%，避免免费额度被刷爆；可按需覆盖
      tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 0.1),
      // 注意：Sentry SDK v11 起移除了 `sendDefaultPii`——PII（IP/cookie 等）
      // 默认即被剥离，无需（也无法）再用开关关闭；隐私立场等价于旧的 false。
    })
    setReporter((error, context) => {
      Sentry.captureException(error, { extra: context })
    })
  } catch (err) {
    // SDK 加载失败不能影响应用启动
    console.warn('[rubbish] Sentry init failed, falling back to console', err)
  }
}
