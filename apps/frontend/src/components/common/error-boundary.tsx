/**
 * 全局 / 局部错误边界。
 *
 * 基于 `react-error-boundary`（不自己造轮子），在其上补三件项目自身需要的事：
 * 1. 统一的中文降级 UI（复用设计系统的 Card/Button，与 ErrorState 风格一致）
 * 2. 错误上报钩子 —— 目前落到 console + 预留 window.__rubbishOnError，
 *    Sentry 接入后由 `lib/monitoring.ts` 覆写该钩子，组件本身无需改动
 * 3. 与 TanStack Query 打通：重置边界时同时重置 query 错误状态，
 *    否则"重试"点了也只会立刻再抛同一个错误
 *
 * 用法：
 * - 全局兜底：`main.tsx` 里包住 RouterProvider（AppErrorBoundary）
 * - 局部兜底：任意子树包 `<ModuleErrorBoundary name="推荐">`，
 *   单个模块炸掉不会拖垮整页
 */
import type { ErrorInfo, ReactNode } from 'react'
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'
import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { reportError } from '@/lib/monitoring'

// react-error-boundary v6 的 onError 签名是 (error: unknown, info: ErrorInfo)，
// error 未必是 Error 实例（可能 throw 了字符串/对象），故按 unknown 接。
function onBoundaryError(error: unknown, info: ErrorInfo) {
  reportError(error, { componentStack: info.componentStack ?? undefined })
}

/** 整页级降级：占满视口，提供"重试"和"回首页"两条出路。 */
function AppFallback({ error, resetErrorBoundary }: FallbackProps) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <CardTitle className="text-base">页面出错了</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            应用遇到了未预期的错误。可以先重试，若反复出现请联系管理员。
          </p>
          {import.meta.env.DEV && (
            <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {message}
            </pre>
          )}
          <div className="flex gap-2">
            <Button onClick={resetErrorBoundary} className="flex-1">
              <RotateCcw className="h-4 w-4" />
              重试
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                // 整页重载而非路由跳转：此时 router 自身也可能处于坏状态
                window.location.href = '/'
              }}
            >
              返回首页
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** 模块级降级：只占据子树位置，不影响外壳导航。 */
function makeModuleFallback(name?: string) {
  return function ModuleFallback({ error, resetErrorBoundary }: FallbackProps) {
    const message = error instanceof Error ? error.message : String(error)
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <div>
          <p className="text-sm font-medium">
            {name ? `${name}加载失败` : '此模块加载失败'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            其他功能不受影响，可以单独重试这一块。
          </p>
          {import.meta.env.DEV && (
            <p className="mt-2 max-w-md text-xs break-all text-muted-foreground">
              {message}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={resetErrorBoundary}>
          <RotateCcw className="h-4 w-4" />
          重试
        </Button>
      </div>
    )
  }
}

/**
 * 全局错误边界。包在 RouterProvider 外层。
 * QueryErrorResetBoundary 让"重试"能同时清掉 react-query 的错误缓存。
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          FallbackComponent={AppFallback}
          onError={onBoundaryError}
          onReset={reset}
        >
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}

/**
 * 模块级错误边界。
 *
 * @param name       出错时展示的模块名，如「推荐」「通知」
 * @param resetKeys  这些值变化时自动复位（典型：路由参数、筛选条件）
 */
export function ModuleErrorBoundary({
  name,
  resetKeys,
  children,
}: {
  name?: string
  resetKeys?: unknown[]
  children: ReactNode
}) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          FallbackComponent={makeModuleFallback(name)}
          onError={onBoundaryError}
          onReset={reset}
          resetKeys={resetKeys}
        >
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
