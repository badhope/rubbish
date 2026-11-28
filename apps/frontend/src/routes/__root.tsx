import { createRootRouteWithContext, redirect } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { AppShell } from '@/components/layout/AppShell'
import { MobileAppShell } from '@/components/layout/MobileAppShell'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useAuth } from '@/hooks/use-auth'
import { useAuthStore, type AuthUser } from '@/lib/auth'
import { isOverseasReadPath, isPublicReadPath, readAccessRegion } from '@/lib/access'
import { api, bootstrapSession } from '@/lib/api'
import { Toaster } from '@/components/ui/sonner'
import { NotFoundPage } from '@/components/common/not-found-page'
import { FeedbackLauncher } from '@/components/common/feedback-launcher'
import type { CapabilitiesResponse, UserResponse } from '@/lib/types'

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
    // access_token 只在 sessionStorage；标签页被回收/手机 WebView 重建后
    // 它没了，但 HttpOnly refresh cookie 还在。先尝试恢复一次，再判断访客，
    // 否则老用户冷启动会被直接送回首页，看起来像“做着做着身份掉了”。
    let { token } = useAuthStore.getState()
    let restored = false
    if (!token) {
      restored = await bootstrapSession()
      token = useAuthStore.getState().token
    }
    // 刷新后 user 只有基础字段；冷启动恢复后补一次 /auth/me，把资料和角色填全。
    const { user } = useAuthStore.getState()
    if (token && (!user || restored)) {
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
        // The interceptor handles refresh responses. Only let the profile
        // request clear the very session whose credentials it submitted.
        if (
          isAxiosError(err) &&
          err.config?.url === '/auth/me' &&
          (err.response?.status === 401 || err.response?.status === 403) &&
          err.config.headers.Authorization === `Bearer ${useAuthStore.getState().token}`
        ) {
          useAuthStore.getState().logout()
        }
      }
    }
    const after = useAuthStore.getState()
    if (!after.token) {
      const region = readAccessRegion()
      const overseasRead = region === 'overseas' && isOverseasReadPath(location.pathname)
      if (!PUBLIC_PATHS.has(location.pathname) && !overseasRead) {
        // 全站登录墙可以在后台关掉。关掉后内容页对访客开放，
        // 但账号/投稿/后台仍然走各自守卫。能力探测是公开接口，
        // 这里缓存几十秒，避免每次点导航都打一次请求。
        let authWallEnabled = true
        try {
          const caps = await context.queryClient.fetchQuery<CapabilitiesResponse>({
            queryKey: ['capabilities'],
            queryFn: async () => (await api.get<CapabilitiesResponse>('/capabilities')).data,
            staleTime: 60_000,
          })
          authWallEnabled = caps.auth_wall_enabled ?? true
        } catch {
          // 探测失败就按登录墙仍在处理，宁可回封面也不放错。
        }
        if (authWallEnabled || !isPublicReadPath(location.pathname)) {
          throw redirect({ to: '/' })
        }
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
