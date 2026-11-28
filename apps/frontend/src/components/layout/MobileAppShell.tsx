import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ChevronDown, LogOut, Menu, X } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useLogout } from '@/hooks/api/use-auth'
import { filterNav } from '@/lib/nav'
import { useUnreadCount } from '@/hooks/api/use-modules'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { AppearanceMenu } from '@/components/appearance-menu'
import { LanguageButton } from '@/components/language-button'
import { BrandMark } from '@/components/common/brand-mark'
import { AmbientBackdrop } from '@/components/common/ambient-backdrop'
import { ModuleErrorBoundary } from '@/components/common/error-boundary'
import { PageTransition } from '@/components/common/page-transition'
import { CookieBanner } from '@/components/common/cookie-banner'
import {
  MOBILE_MORE,
  MOBILE_MORE_GROUP_ORDER,
  MOBILE_TABS,
  type MobileTab,
} from './mobile-nav'

function MobileTabButton({
  tab,
  active,
  badge,
  onClick,
}: {
  tab: MobileTab
  active: boolean
  badge?: number
  onClick: () => void
}) {
  const Icon = tab.icon
  // 底部 5 个 Tab 里没有 /notifications；未读提醒应落在「我的」上。
  const showBadge = tab.to === '/me' && (badge ?? 0) > 0
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : 'false'}
      className={cn(
        'mobile-tab flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-xs',
        active ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      <span className="relative">
        <Icon className="h-5 w-5" />
        {showBadge && (
          <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-destructive" />
        )}
      </span>
      <span className="max-w-full truncate">{tab.label}</span>
    </button>
  )
}

export function MobileAppShell() {
  const { isAuthenticated, isAdmin, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const logoutMut = useLogout()
  const { data: unread } = useUnreadCount({ enabled: isAuthenticated })
  const [moreOpen, setMoreOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ 我的空间: true })
  const moreItems = filterNav(MOBILE_MORE, {
    isAuthenticated,
    isAdmin,
    roles: user?.roles ?? [],
  })

  // 认证页（登录/注册/找回密码/验证邮箱）不展示底部 Tab 栏与 FAB
  const isAuthPage = [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/restore-account',
    '/auth/oidc/callback',
  ].some((p) => location.pathname.startsWith(p))
  const showChrome = !isAuthPage && isAuthenticated

  // 首页自带报头/导航/页脚：不套 MobileAppShell 的 h-14 头部，
  // 但必须渲染底部 Tab（首页也能切 Tab）。
  const isHome = location.pathname === '/'

  // 资源详情页自带底部固定操作栏（z-40），会盖住 Tab 栏
  const hasOwnBottomBar = /^\/catalog\/\d+/.test(location.pathname)
  // 阅读页：Tab 栏随滚动方向隐藏
  const immersive = /^\/catalog\/\d+/.test(location.pathname)
  const [barHidden, setBarHidden] = useState(false)

  useEffect(() => {
    if (!immersive) {
      setBarHidden(false)
      return
    }
    let lastY = 0
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | Document
      const y =
        el instanceof HTMLElement && el !== document.documentElement
          ? el.scrollTop
          : window.scrollY
      const dy = y - lastY
      if (y < 48) setBarHidden(false)
      else if (dy > 14) setBarHidden(true)
      else if (dy < -14) setBarHidden(false)
      lastY = y
    }
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [immersive])

  // 抽屉打开时锁住背景滚动；换页、Esc 都把它关掉，避免“点完还挂在半空”。
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [moreOpen])

  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname])

  const currentGroup = moreItems.find((item) => item.to === location.pathname)?.group
  useEffect(() => {
    if (!moreOpen || !currentGroup) return
    setOpenGroups((groups) => (groups[currentGroup] ? groups : { ...groups, [currentGroup]: true }))
  }, [moreOpen, currentGroup])

  // 创建动作从页面内主按钮进入，不再做右下角悬浮“＋”。

  // 认证页：不套业务外壳，只保留返回首页的品牌入口
  if (isAuthPage) {
    return (
      <div className="relative min-h-screen bg-background">
        <Link
          to="/"
          aria-label="返回 Rubbish 首页"
          className="fixed left-5 top-4 z-10 inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
        >
          <BrandMark className="h-5 w-5 text-primary" />
          <span>Rubbish</span>
          <span className="text-[11px] font-normal text-muted-foreground">返回首页</span>
        </Link>
        <div className="fixed right-4 top-3 z-10">
          <LanguageButton />
        </div>
        <CookieBanner />
        <ModuleErrorBoundary name="页面" resetKeys={[location.pathname]}>
          <PageTransition>
            <Outlet />
          </PageTransition>
        </ModuleErrorBoundary>
      </div>
    )
  }

  const isActive = (to: string) =>
    location.pathname === to || location.pathname.startsWith(to + '/')

  const go = (to: string) => {
    void navigate({ to })
  }

  // 底部 5 Tab 栏：首页与所有非认证页都渲染
  // z-50 确保压在首页自己的 sticky header(z-40) 与 back-to-top 按钮之上
  const bottomTab = showChrome && !hasOwnBottomBar && (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 grid h-16 grid-cols-5 items-stretch border-t bg-background backdrop-blur pb-[env(safe-area-inset-bottom)]',
        'transition-transform duration-300 ease-out',
        immersive && barHidden ? 'translate-y-full' : 'translate-y-0',
      )}
      aria-label="主导航"
    >
      {MOBILE_TABS.map((tab) => (
        <MobileTabButton
          key={tab.to}
          tab={tab}
          active={isActive(tab.to)}
          badge={unread?.unread}
          onClick={() => go(tab.to)}
        />
      ))}
    </nav>
  )

  // 首页：不套 MobileAppShell 头部，只渲染内容 + 底部 Tab
  if (isHome) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <AmbientBackdrop />
        <main className="relative z-10 min-w-0 flex-1 overflow-x-hidden pb-[calc(8rem+env(safe-area-inset-bottom))]">
          {isAuthenticated && <CookieBanner />}
          <div className="mx-auto w-full max-w-screen-sm overflow-x-clip px-5 sm:px-6">
            <ModuleErrorBoundary name="页面" resetKeys={[location.pathname]}>
              <PageTransition>
                <Outlet />
              </PageTransition>
            </ModuleErrorBoundary>
          </div>
        </main>
        {bottomTab}
      </div>
    )
  }

  // 普通内页：header + 内容 + 底部 Tab
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AmbientBackdrop />
      {/* 紧凑头部：logo + 主题切换 + 显式「功能」入口 */}
      <header className="app-header-rule sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-5 backdrop-blur relative sm:px-6 supports-[backdrop-filter]:bg-background/60">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 h-9 w-9 shrink-0"
            onClick={() => setMoreOpen(true)}
            aria-label="打开导航"
            aria-expanded={moreOpen}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Link to="/" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
            <BrandMark className="h-5 w-5 shrink-0" />
            <span className="truncate">Rubbish</span>
          </Link>
        </div>
        <div className="flex items-center gap-1.5">
          <LanguageButton />
          <AppearanceMenu />
        </div>
      </header>

      {/* 内容区：底部留白避开固定 Tab 栏 */}
      <main
        className={cn(
          'relative z-10 min-w-0 flex-1 overflow-y-auto overflow-x-hidden',
          hasOwnBottomBar
            ? 'pb-[calc(8.5rem+env(safe-area-inset-bottom))]'
            : immersive
              ? 'pb-[calc(4.5rem+env(safe-area-inset-bottom))]'
              : showChrome
                ? 'pb-[calc(8rem+env(safe-area-inset-bottom))]'
                : 'pb-4',
        )}
      >
        <div className="mx-auto w-full max-w-screen-sm overflow-x-clip px-5 sm:px-6 py-4">
          <CookieBanner />
          <ModuleErrorBoundary name="页面" resetKeys={[location.pathname]}>
            <PageTransition>
              <Outlet />
            </PageTransition>
          </ModuleErrorBoundary>
        </div>
      </main>

      {bottomTab}

      {/* 移动端功能抽屉：从左侧展开，保留当前页面与底部 Tab，不再跳整页。 */}
      <div
        className={cn(
          'fixed inset-0 z-[60] md:hidden',
          moreOpen ? 'visible pointer-events-auto' : 'invisible pointer-events-none',
        )}
        aria-hidden={!moreOpen}
      >
        <button
          type="button"
          aria-label="关闭导航"
          className={cn(
            'absolute inset-0 bg-black/45 transition-opacity duration-200',
            moreOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setMoreOpen(false)}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="全部导航"
          className={cn(
            'absolute inset-y-0 left-0 flex w-[86vw] max-w-[340px] flex-col border-r bg-background shadow-2xl transition-transform duration-250 ease-out',
            moreOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex h-14 items-center justify-between border-b px-4">
            <div>
              <p className="text-sm font-medium">全部功能</p>
              <p className="text-[10px] text-muted-foreground">当前页面不动，选完直接过去</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setMoreOpen(false)} aria-label="关闭导航">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <nav className="flex-1 overflow-y-auto px-4 py-3">
            {MOBILE_MORE_GROUP_ORDER.map((group) => {
              const items = moreItems.filter((item) => item.group === group)
              if (items.length === 0) return null
              const open = Boolean(openGroups[group])
              return (
                <section key={group} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((current) => ({ ...current, [group]: !current[group] }))
                    }
                    aria-expanded={open}
                    className="flex min-h-[48px] w-full items-center justify-between gap-3 py-2 text-left"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {group}
                      <span className="rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                        {items.length}
                      </span>
                    </span>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 text-muted-foreground transition-transform',
                        open && 'rotate-180',
                      )}
                    />
                  </button>
                  {open ? (
                    <div className="pb-3">
                      {items.map((item) => {
                        const Icon = item.icon
                        const active = location.pathname === item.to
                        return (
                          <Link
                            key={`${item.to}-${item.label}`}
                            to={item.to}
                            search={item.search}
                            onClick={() => setMoreOpen(false)}
                            data-active={active ? 'true' : 'false'}
                            className={cn(
                              'flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                              active
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        )
                      })}
                    </div>
                  ) : null}
                </section>
              )
            })}
          </nav>

          <div className="border-t p-4">
            {isAuthenticated ? (
              <Button
                variant="outline"
                className="w-full text-muted-foreground"
                disabled={logoutMut.isPending}
                onClick={() => {
                  setMoreOpen(false)
                  void logoutMut.mutateAsync().then(
                    () => {
                      toast.success('已退出登录')
                      void navigate({ to: '/' })
                    },
                    () => toast.error('退出没成功，过一会儿再试'),
                  )
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </Button>
            ) : (
              <Button className="w-full" asChild>
                <Link to="/login" onClick={() => setMoreOpen(false)}>
                  登录 / 注册
                </Link>
              </Button>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
