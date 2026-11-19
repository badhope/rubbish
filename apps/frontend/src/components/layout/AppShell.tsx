import { Fragment, useEffect, useState, type FormEvent } from 'react'
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import {
  BookOpen,
  Building2,
  ChevronDown,
  ChevronLeft,
  ClipboardCheck,
  Eye,
  Gavel,
  Home,
  Menu,
  PenLine,
  Search,
  ShieldCheck,
  User,
  Award,
  FileSignature,
  MessagesSquare,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { OnboardingTour } from '@/components/common/onboarding-tour'
import { useAuth } from '@/hooks/use-auth'
import { useLogout } from '@/hooks/api/use-auth'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/common/brand-mark'
import { AmbientBackdrop } from '@/components/common/ambient-backdrop'
import { filterNav, resolveActiveNavPath, type NavItem } from '@/lib/nav'
import { ModuleErrorBoundary } from '@/components/common/error-boundary'
import { PageTransition } from '@/components/common/page-transition'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AppearanceMenu } from '@/components/appearance-menu'
import { CookieBanner } from '@/components/common/cookie-banner'
import { PageViewTracker } from '@/components/common/page-view-tracker'
import { groupLabel, navLabel, text, useLang } from '@/lib/i18n'

const NAV: NavItem[] = [
  // 一级入口固定五项：首页 / 论文 / 副刊 / 讨论 / 我的。
  // 栏目、卷期、指标等期刊门面退到「期刊」二级组，不再和社区抢一级入口。
  { to: '/', label: '首页', icon: Home, group: '一级入口' },
  { to: '/catalog', label: '论文', icon: BookOpen, group: '一级入口' },
  { to: '/submissions', label: '投稿', icon: PenLine, group: '一级入口' },
  { to: '/forum', label: '社区', icon: MessagesSquare, group: '一级入口' },
  { to: '/me', label: '我的', icon: User, group: '一级入口' },

  // 我的工作：只放需要登录的个人链路。
  {
    to: '/review/assignments',
    label: '审稿工作台',
    icon: ClipboardCheck,
    auth: true,
    roles: ['reviewer', 'senior_reviewer', 'editor_in_chief'],
    group: '我的工作',
    subgroup: '编辑与投稿',
  },
  {
    to: '/editor/workbench',
    label: '主编工作台',
    icon: Gavel,
    auth: true,
    roles: ['editor', 'section_editor', 'board_editor', 'deputy_editor', 'chief_editor', 'editor_in_chief'],
    group: '我的工作',
    subgroup: '编辑与投稿',
  },

  // 期刊门面：栏目和卷期都收进 /catalog 的筛选；这里只保留审稿广场、关于、指南。
  { to: '/review/board', label: '审稿广场', icon: Eye, group: '期刊' },
  { to: '/about', label: '关于与指标', icon: Building2, group: '期刊' },
  { to: '/guide', label: '投稿指南', icon: PenLine, group: '期刊' },

  // admin 组：只保留一个后台入口；具体管理页收进 /admin 的分组卡片。
  { to: '/admin', label: '管理后台', icon: Gavel, auth: true, adminOnly: true, group: '站点管理' },
]

const PUBLIC_NAV = NAV.slice(0, 5)

// 公开页与工作台的分界：后台、审稿指派、主编工作台、待审列表保留业务左栏；
// 其余页面用顶部 5 导航，公开页不再出现全局左栏。
const WORK_ROUTE_PREFIXES = [
  '/admin',
  '/editor',
  '/review/assignments',
  '/review/quick',
  '/submissions/pending',
]

function isWorkRoute(pathname: string): boolean {
  return WORK_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

function resolvePublicNavPath(pathname: string): string | undefined {
  if (pathname === '/') return '/'
  if (
    ['/catalog'].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return '/catalog'
  }
  if (pathname === '/submissions' || pathname.startsWith('/submissions/') || pathname.startsWith('/ingest')) {
    return '/submissions'
  }
  if (pathname === '/forum' || pathname.startsWith('/forum/')) return '/forum'
  if (
    ['/me', '/library', '/follows', '/recommendations', '/appeals', '/claim'].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return '/me'
  }
  return undefined
}

export function AppShell() {
  // collapsed 仅用于桌面端（≥md）侧边栏宽窄切换
  // 侧栏默认宽度按设备档位给：≥1180 展开；平板/小笔记本（768–1180）
  // 先收成图标栏，把正文宽度让出来。用户手动切换后记住选择。
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    const saved = window.localStorage.getItem('rubbish_rail_collapsed')
    if (saved === '1') return true
    if (saved === '0') return false
    return window.innerWidth < 1180
  })
  // mobileOpen 控制 <md 抽屉开合；路由切换后自动关闭
  const [mobileOpen, setMobileOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [cmdQ, setCmdQ] = useState('')
  const [publicQ, setPublicQ] = useState('')
  // 侧边栏只默认展开一级入口；工作台/期刊/后台按需展开，点开就收起另一组，
  // 避免一进后台就被 15 个管理项铺满。
  const [openGroup, setOpenGroup] = useState<string>('一级入口')
  const [openSubgroup, setOpenSubgroup] = useState<string>('')
  const { isAuthenticated, isAdmin, user, logout } = useAuth()
  const displayName = user?.display_name || user?.username || ''
  const navigate = useNavigate()
  const location = useLocation()
  const logoutMut = useLogout()
  const lang = useLang()

  const visibleNav = filterNav(NAV, {
    isAuthenticated,
    isAdmin,
    roles: user?.roles ?? [],
  })

  const activePath = resolveActiveNavPath(location.pathname, visibleNav)

  // 当前页面所在的组自动展开，用户不用先找自己在哪。
  // 只依赖字符串，不依赖每次 render 都新建的 visibleNav，否则用户手动切组会被重置。
  const activeItem = visibleNav.find((item) => item.to === activePath)
  const activeGroup = activeItem?.group
  const activeSubgroup = activeItem?.subgroup
  useEffect(() => {
    if (activeGroup) setOpenGroup(activeGroup)
    if (activeSubgroup) setOpenSubgroup(activeSubgroup)
  }, [activePath, activeGroup, activeSubgroup])

  // 路由变化时关闭移动端抽屉，避免点击导航后抽屉仍挡住内容
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // 移动端抽屉打开时锁 body 滚动，避免背景滚动穿透
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [mobileOpen])

  // ESC 关闭抽屉
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  // ⌘K / Ctrl+K 全局搜索：任何页面都能唤起，回车跳目录。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdOpen((v) => !v)
      }
      if (e.key === 'Escape') setCmdOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submitCmd = (e: FormEvent) => {
    e.preventDefault()
    const q = cmdQ.trim()
    setCmdOpen(false)
    void navigate({ to: '/catalog', search: q ? { q } : {} })
  }

  const submitPublicSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = publicQ.trim()
    void navigate({ to: '/catalog', search: q ? { q } : {} })
  }

  const onLogout = async () => {
    try {
      await logoutMut.mutateAsync()
      toast.success('已退出登录')
      void navigate({ to: '/login' })
    } catch {
      // 即使 backend logout 失败也清本地状态
      logout()
      void navigate({ to: '/login' })
    }
  }

  const userMenu = isAuthenticated && user ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" aria-label={text('账号菜单', lang)}>
          <Avatar className="h-7 w-7">
            <AvatarImage src={user.avatar_url ?? undefined} alt="" />
            <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm sm:inline">{displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/me">
            <Award className="h-4 w-4" />
            {text('个人中心', lang)}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/submissions">
            <FileSignature className="h-4 w-4" />
            我的提交
          </Link>
        </DropdownMenuItem>
        {(user.roles?.includes('reviewer') || user.roles?.includes('senior_reviewer') || user.roles?.includes('editor_in_chief') || isAdmin) && (
          <DropdownMenuItem asChild>
            <Link to="/review/assignments">
              <ClipboardCheck className="h-4 w-4" />
              {text('审稿工作台', lang)}
            </Link>
          </DropdownMenuItem>
        )}
        {(user.roles?.some((r) => ['editor', 'section_editor', 'board_editor', 'deputy_editor', 'chief_editor', 'editor_in_chief'].includes(r)) || isAdmin) && (
          <DropdownMenuItem asChild>
            <Link to="/editor/workbench">
              <Gavel className="h-4 w-4" />
              {text('主编工作台', lang)}
            </Link>
          </DropdownMenuItem>
        )}
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldCheck className="h-4 w-4" />
              管理后台
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} className="text-destructive">
          {text('退出登录', lang)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" size="sm">
        <Link to="/login">{text('登录', lang)}</Link>
      </Button>
      <Button asChild size="sm">
        <Link to="/register">{text('注册', lang)}</Link>
      </Button>
    </div>
  )

  // 按 group 切段，交给下面的手风琴渲染；不再把 30 多个入口平铺成一条长列表。
  const navGroups = visibleNav.reduce<Array<{ name: string; items: NavItem[] }>>((acc, item) => {
    const name = item.group ?? ''
    const last = acc[acc.length - 1]
    if (last && last.name === name) last.items.push(item)
    else acc.push({ name, items: [item] })
    return acc
  }, [])

  const renderNavLink = (item: NavItem) => {
    const Icon = item.icon
    const active = item.to === activePath
    return (
      <Link
        key={item.to}
        to={item.to}
        data-active={active ? 'true' : 'false'}
        className={cn(
          'nav-item mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="flex-1">{navLabel(item.to, item.label, lang)}</span>}
      </Link>
    )
  }

  // 期刊门面模式：首页走独立的全宽 editorial 版式（自带报头/导航/页脚），
  // 不套工作台侧边栏 —— 否则访客看到的是"作者后台"而不是对外期刊官网。
  // 注意：提前返回必须放在全部 hooks 之后（rules of hooks），
  // 否则会形成条件式 hook 调用（react-hooks/rules-of-hooks 会拦截）。
  // 访客入口页（登录/注册/找回密码/邮箱验证）同样不套工作台侧栏：
  // 未登录用户看到「我的提交/用户管理」这类导航只会困惑，且登录框应居中独立。
  const AUTH_FACADE = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email']
  if (location.pathname === '/' || AUTH_FACADE.includes(location.pathname)) {
    return (
      <div className="min-h-screen bg-background">
        <ModuleErrorBoundary name="页面" resetKeys={[location.pathname]}>
          <PageTransition>
            <Outlet />
          </PageTransition>
        </ModuleErrorBoundary>
        <CookieBanner />
        <PageViewTracker />
      </div>
    )
  }

  // 公开页壳：桌面顶部 5 导航，不再套工作台全局左栏。
  // 工作台 / 后台 / 审稿指派仍走下面的业务左栏。
  if (!isWorkRoute(location.pathname)) {
    const publicActive = resolvePublicNavPath(location.pathname)
    return (
      <div className="min-h-screen bg-background">
        <AmbientBackdrop />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
        >
          {text('跳到主要内容', lang)}
        </a>
        <header className="app-header-rule sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between gap-4 px-5 sm:px-7 lg:px-10 xl:px-12">
            <Link to="/" className="flex min-w-0 items-center gap-2.5">
              <BrandMark className="h-7 w-7 shrink-0 text-primary" />
              <span className="flex min-w-0 flex-col leading-none">
                <span className="font-serif text-lg font-semibold tracking-tight">Rubbish</span>
                <span className="mt-1 hidden truncate text-[10px] uppercase tracking-[0.28em] text-muted-foreground sm:block">
                  An Academic Bottom Journal
                </span>
              </span>
            </Link>

            <nav className="hidden items-center gap-5 text-sm md:flex" aria-label="主导航">
              {PUBLIC_NAV.map((item) => {
                const active = publicActive === item.to
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    data-active={active ? 'true' : 'false'}
                    className={cn(
                      'link-underline transition-colors hover:text-foreground',
                      active ? 'font-medium text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {navLabel(item.to, item.label, lang)}
                  </Link>
                )
              })}
            </nav>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <form onSubmit={submitPublicSearch} className="hidden lg:block">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={publicQ}
                    onChange={(e) => setPublicQ(e.target.value)}
                    placeholder="检索…"
                    aria-label="检索"
                    className="h-9 w-44 rounded-full border bg-transparent pl-8 text-sm"
                  />
                </div>
              </form>
              <AppearanceMenu />
              {userMenu}
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="outline-none">
          <div className="mx-auto w-full max-w-[1600px] px-5 py-6 sm:px-7 sm:py-8 lg:px-10 xl:px-12">
            <ModuleErrorBoundary name="页面" resetKeys={[location.pathname]}>
              <PageTransition>
                <Outlet />
              </PageTransition>
            </ModuleErrorBoundary>
          </div>
        </main>
        <OnboardingTour />
        <CookieBanner />
        <PageViewTracker />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AmbientBackdrop />
      {/* 移动端遮罩：<md 抽屉打开时显示 */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow">{text('跳到主要内容', lang)}</a>
      <aside
        className={cn(
          'sticky top-0 z-40 flex h-screen flex-col border-r bg-sidebar text-sidebar-foreground transition-all relative',
          // 桌面端：根据 collapsed 切换宽窄；移动端：固定窄宽 + translate 控制显隐
          'md:sticky md:translate-x-0',
          collapsed ? 'md:w-14' : 'md:w-[220px]',
          'w-[220px] max-md:fixed max-md:transition-transform',
          mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <BrandMark className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Rubbish</span>}
          </Link>
          {/* 移动端关闭按钮（仅 <md 显示） */}
          <button
            type="button"
            className="text-sidebar-foreground/60 hover:text-sidebar-foreground md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label={text('关闭菜单', lang)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {navGroups.map((group) => {
            // 一级入口永远展开；其余组同一时间只开一个，避免整栏都是模块。
            const isTop = group.name === '一级入口'
            const isOpen = collapsed || isTop || openGroup === group.name
            const subgroups =
              !collapsed && group.items.some((item) => item.subgroup)
                ? (() => {
                    const order: string[] = []
                    const buckets = new Map<string, NavItem[]>()
                    for (const item of group.items) {
                      const name = item.subgroup ?? ''
                      if (!buckets.has(name)) {
                        order.push(name)
                        buckets.set(name, [])
                      }
                      buckets.get(name)!.push(item)
                    }
                    return order.map((name) => ({ name, items: buckets.get(name)! }))
                  })()
                : null
            return (
              <Fragment key={group.name}>
                {!isTop && !collapsed && (
                  <button
                    type="button"
                    onClick={() => setOpenGroup(isOpen ? '' : group.name)}
                    aria-expanded={isOpen}
                    className="nav-group-label mb-1 mt-2 flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-widest text-sidebar-foreground/45 transition-colors hover:text-sidebar-foreground/80"
                  >
                    <span>{groupLabel(group.name, lang)}</span>
                    <ChevronDown
                      className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')}
                    />
                  </button>
                )}
                {isOpen &&
                  (subgroups
                    ? subgroups.map((sub) => {
                        const subOpen = openSubgroup === sub.name
                        return (
                          <Fragment key={sub.name}>
                            <button
                              type="button"
                              onClick={() => setOpenSubgroup(subOpen ? '' : sub.name)}
                              aria-expanded={subOpen}
                              className="mt-1 flex w-full items-center justify-between rounded-md px-3 py-1 text-left text-[10px] font-medium tracking-wide text-sidebar-foreground/35 transition-colors hover:text-sidebar-foreground/70"
                            >
                              <span>{groupLabel(sub.name, lang)}</span>
                              <ChevronDown
                                className={cn(
                                  'h-3 w-3 transition-transform',
                                  subOpen && 'rotate-180',
                                )}
                              />
                            </button>
                            {subOpen && sub.items.map(renderNavLink)}
                          </Fragment>
                        )
                      })
                    : group.items.map(renderNavLink))}
                {!isTop && collapsed && (
                  <div className="my-2 border-t border-sidebar-foreground/15" aria-hidden />
                )}
              </Fragment>
            )
          })}
        </nav>
        {/* 身份卡：始终在左栏底部，回答“我是谁、能做什么” */}
        {!collapsed && (
          <div className="mx-3 mb-2 rounded-lg border border-sidebar-foreground/15 bg-sidebar-accent/30 p-3">
            {isAuthenticated && user ? (
              <div className="flex items-center gap-2.5">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={user.avatar_url ?? undefined} alt="" />
                  <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{displayName}</p>
                  <p className="truncate text-[10px] text-sidebar-foreground/55">
                    {user.roles?.some((r) => ['chief_editor','editor_in_chief'].includes(r)) ? '主编' : user.roles?.includes('reviewer') ? '审稿人' : '作者 / 读者'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] leading-relaxed text-sidebar-foreground/70">登录后可投稿、认领与跟踪审稿。</p>
                <Button asChild size="sm" className="h-8 w-full text-xs"><Link to="/login">登录 / 注册</Link></Button>
              </div>
            )}
          </div>
        )}
        {/* 折叠按钮仅桌面端可见 */}
        <button
          type="button"
          onClick={() =>
            setCollapsed((v) => {
              try {
                window.localStorage.setItem('rubbish_rail_collapsed', v ? '0' : '1')
              } catch {
                // 隐私模式下无法写入，忽略即可。
              }
              return !v
            })
          }
          className="hidden h-12 items-center justify-center border-t text-sidebar-foreground/60 hover:text-sidebar-foreground md:flex"
          aria-label={text(collapsed ? '展开侧边栏' : '收起侧边栏', lang)}
        >
          <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
        </button>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="app-header-rule sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          {/* 左侧：移动端汉堡 + 折叠状态下的页面标识 */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label={text('打开菜单', lang)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
          {/* 右侧：主题切换 + 用户菜单/登录注册 */}
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="outline" size="sm" className="hidden h-8 gap-2 px-2.5 text-xs sm:inline-flex" onClick={() => setCmdOpen(true)}>
              <Search className="h-3.5 w-3.5" />
              {text('搜索', lang)}
              <kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
            </Button>
            <AppearanceMenu />
            {userMenu}
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
          {/* 响应式 padding：移动端紧凑，桌面端宽松 */}
          <div className="mx-auto w-full max-w-[1600px] px-5 py-6 sm:px-7 sm:py-8 lg:px-10 xl:px-12">
            {/* 页面级错误边界：单个路由崩溃时侧边栏/头部仍可用，
                resetKeys 绑定 pathname —— 换页自动复位，无需手动点重试 */}
            <ModuleErrorBoundary name="页面" resetKeys={[location.pathname]}>
              <PageTransition>
                <Outlet />
              </PageTransition>
            </ModuleErrorBoundary>
          </div>
        </main>
      </div>
      {cmdOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[18vh]" onClick={() => setCmdOpen(false)}>
          <form onSubmit={submitCmd} className="w-full max-w-xl overflow-hidden rounded-xl border bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input autoFocus value={cmdQ} onChange={(e) => setCmdQ(e.target.value)} placeholder="搜索论文、副刊、作者、关键词…" className="h-9 flex-1 bg-transparent text-sm outline-none" />
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Enter</kbd>
            </div>
            <div className="px-4 py-2 text-[11px] text-muted-foreground">回车进入目录；Esc 关闭。论文与副刊分轨展示。</div>
          </form>
        </div>
      )}
      <OnboardingTour />
      <CookieBanner />
    </div>
  )
}
