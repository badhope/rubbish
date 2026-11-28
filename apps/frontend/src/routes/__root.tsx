import { createRootRouteWithContext, redirect } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { AppShell } from '@/components/layout/AppShell'
import { MobileAppShell } from '@/components/layout/MobileAppShell'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useAuth } from '@/hooks/use-auth'
import { useAuthStore, type AuthUser } from '@/lib/auth'
import { isOverseasReadPath, readAccessRegion } from '@/lib/access'
import { api } from '@/lib/api'
import { Toaster } from '@/components/ui/sonner'
import { NotFoundPage } from '@/components/common/not-found-page'
import { FeedbackLauncher } from '@/components/common/feedback-launcher'
import type { UserResponse } from '@/lib/types'

interface RouterContext {
  queryClient: QueryClient
}

// 访客只能停在封面和认证流程里。其余页面在路由层直接回封面；
// 真正的数据隔离由后端 AuthWallMiddleware 兜底。
const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/restore-account',
  '/auth/oidc/callback',
  '/privacy',
  '/accessibility',
  '/about',
  '/guide',
  '/status',
  '/403',
])

function isSessionRejected(error: unknown): boolean {
  const status = isAxiosError(error) ? error.response?.status : undefined
  return status === 401 || status === 403
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    // 刷新页面后 token 还在但 user 为 null：拉一次 /auth/me 回填 store，
    // 否则 admin 路由守卫会误判跳 /login，AppShell 用户菜单也会消失
    const { token, user } = useAuthStore.getState()
    if (token && !user) {
      try {
        const res = await context.queryClient.fetchQuery<UserResponse>({
          queryKey: ['auth', 'me'],
          queryFn: async () => (await api.get<UserResponse>('/auth/me')).data,
          retry: (failures, error) => failures < 1 && !isSessionRejected(error),
          staleTime: 60_000,
        })
        useAuthStore.getState().setUser({
          id: res.id,
          username: res.username,
          display_name: res.display_name ?? null,
          avatar_url: res.avatar_url ?? null,
          is_admin: res.is_admin,
          roles: res.roles ?? [],
        } satisfies AuthUser)
      } catch (err) {
        // 只有后端明确说「你这个 token 不认」才登出。网络抖动、
        // 5xx 这类瞬时故障不能把用户踢下线——否则刷新一次页面就掉登录。
        const status = (err as { response?: { status?: number } }).response
          ?.status
        if (status === 401 || status === 403) {
          useAuthStore.getState().logout()
        }
      }
    }
    const after = useAuthStore.getState()
    if (!after.token) {
      const region = readAccessRegion()
      const overseasRead = region === 'overseas' && isOverseasReadPath(location.pathname)
      if (!PUBLIC_PATHS.has(location.pathname) && !overseasRead) {
        throw redirect({ to: '/' })
      }
    }
  },
  component: RootLayout,
  notFoundComponent: NotFoundPage,
})

function RootLayout() {
  // Playwright 跑 E2E 时 navigator.webdriver === true；
  // 这种情况下隐藏 Router Devtools 浮层，避免它拦截页面右下角按钮的点击
  const showDevtools = import.meta.env.DEV && !navigator.webdriver
  // 移动端用独立的 MobileAppShell（底部 Tab 栏 + FAB + 底部抽屉），
  // 与桌面侧边栏是完全不同的设计，运行时按视口切换，共享同一套路由。
  const isMobile = useIsMobile()
  const { isAuthenticated } = useAuth()
  return (
    <>
      {isMobile ? <MobileAppShell /> : <AppShell />}
      {isAuthenticated && <FeedbackLauncher />}
      <Toaster position="top-right" richColors closeButton />
      {showDevtools && <TanStackRouterDevtools />}
    </>
  )
}
