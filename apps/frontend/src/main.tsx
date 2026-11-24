import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { ThemeProvider } from './components/theme-provider'
import { I18nRuntime } from './components/i18n-runtime'
import { initLang } from './lib/i18n'
import { AppErrorBoundary } from './components/common/error-boundary'
import { initMonitoring, installGlobalErrorHandlers } from './lib/monitoring'
import { installQaAuth } from './lib/qa'
// 衬线字体（自托管可变字重，中文按 unicode-range 分片按需加载）
import './index.css'

// 语言先于 React 定下来：共享的 ?lang=en 链接不应先闪一帧中文。
initLang()

// window.onerror + unhandledrejection 兜底（ErrorBoundary 只覆盖渲染期错误）
installGlobalErrorHandlers()
// QA-only machine identity; no-op in normal builds.
installQaAuth()
// 监控后端初始化。未配置 VITE_SENTRY_DSN 时为 no-op；
// 不 await —— 上报能力晚几十毫秒就绪不影响首屏，错误在此之前由 console reporter 兜住。
void initMonitoring()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      // 切回标签页/网络恢复时刷新：站点内容会更新（新发布文章、评论），
      // 关闭聚焦刷新会让用户看到过期目录（此前 5 分钟内看不到新发表）。
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
})

// 首屏骨架之后还有一段“路由已切换、数据未到”的空窗：这里补统一占位，
// 避免每个页面各写一套 loading，也避免切页时出现纯白闪屏。
function RoutePending() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8" aria-busy="true" aria-live="polite">
      <div className="mb-4 h-7 w-40 animate-pulse rounded bg-muted" />
      <div className="mb-6 h-4 w-72 animate-pulse rounded bg-muted/70" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border bg-card" />
        ))}
      </div>
    </div>
  )
}

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  context: { queryClient },
  defaultPendingComponent: RoutePending,
  // 120ms 内完成的切换不闪骨架；真要等，至少显示 400ms 免得闪烁。
  defaultPendingMs: 120,
  defaultPendingMinMs: 400,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <I18nRuntime />
      <QueryClientProvider client={queryClient}>
        <AppErrorBoundary>
          <RouterProvider router={router} />
        </AppErrorBoundary>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
