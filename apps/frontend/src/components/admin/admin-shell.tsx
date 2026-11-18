import { Link, Outlet, useLocation } from '@tanstack/react-router'
import {
  CalendarDays,
  FileText,
  Gauge,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** 后台统一壳：六个业务域共用一条页签，子页仍保留各自的表单与权限。 */
const DOMAINS = [
  { key: 'overview', label: '总览', to: '/admin', icon: Gauge, paths: ['/admin'] },
  {
    key: 'people',
    label: '用户',
    to: '/admin/users',
    icon: Users,
    paths: ['/admin/users', '/admin/role-applications', '/admin/claims'],
  },
  {
    key: 'content',
    label: '内容',
    to: '/admin/announcements',
    icon: FileText,
    paths: [
      '/admin/announcements',
      '/admin/forum-boards',
      '/admin/reports',
      '/admin/comments',
      '/admin/desk-subscribers',
    ],
  },
  {
    key: 'journal',
    label: '期刊',
    to: '/admin/issues',
    icon: CalendarDays,
    paths: ['/admin/volumes', '/admin/issues', '/admin/releases', '/admin/journal', '/admin/settings'],
  },
  { key: 'economy', label: '经济', to: '/admin/finance', icon: Wallet, paths: ['/admin/shop', '/admin/finance'] },
  {
    key: 'system',
    label: '系统',
    to: '/admin/system-health',
    icon: ShieldCheck,
    paths: ['/admin/system-health', '/admin/audit-logs'],
  },
] as const

const SUB_NAV: Record<string, { to: string; label: string }[]> = {
  people: [
    { to: '/admin/users', label: '用户管理' },
    { to: '/admin/role-applications', label: '角色申请' },
    { to: '/admin/claims', label: '认领审批' },
  ],
  content: [
    { to: '/admin/announcements', label: '公告' },
    { to: '/admin/forum-boards', label: '版块' },
    { to: '/admin/reports', label: '举报' },
    { to: '/admin/comments', label: '评论' },
    { to: '/admin/desk-subscribers', label: '邮件订阅' },
  ],
  journal: [
    { to: '/admin/volumes', label: '卷' },
    { to: '/admin/issues', label: '期' },
    { to: '/admin/releases', label: '发布' },
    { to: '/admin/journal', label: '期刊信息' },
    { to: '/admin/settings', label: '期刊设置' },
  ],
  economy: [
    { to: '/admin/finance', label: '财务' },
    { to: '/admin/shop', label: '商城' },
  ],
  system: [
    { to: '/admin/system-health', label: '系统健康' },
    { to: '/admin/audit-logs', label: '审计日志' },
  ],
}

function isActive(pathname: string, path: string) {
  return pathname === path || (path !== '/admin' && pathname.startsWith(`${path}/`))
}

export function AdminShell() {
  const pathname = useLocation({ select: (state) => state.pathname })
  const activeDomain = DOMAINS.find((domain) => domain.paths.some((path) => isActive(pathname, path)))
  const subNav = activeDomain ? SUB_NAV[activeDomain.key] : undefined

  return (
    <div className="w-full">
      <header className="border-b bg-background/95">
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 pt-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/75">
                Editorial desk
              </p>
              <h1 className="mt-1 font-serif text-lg tracking-tight sm:text-xl">后台管理</h1>
            </div>
            <p className="hidden max-w-[260px] text-right text-[11px] leading-relaxed text-muted-foreground sm:block">
              按业务域切换，表单仍在各自子页；权限、审计和分页共用一套规则。
            </p>
          </div>

          <nav aria-label="后台业务域" className="scrollbar-none -mx-1 mt-3 flex gap-1 overflow-x-auto">
            {DOMAINS.map((domain) => {
              const Icon = domain.icon
              const active = domain.key === activeDomain?.key
              return (
                <Link
                  key={domain.key}
                  to={domain.to}
                  data-active={active ? 'true' : 'false'}
                  className={cn(
                    'relative inline-flex min-h-[42px] shrink-0 items-center gap-1.5 px-2.5 text-xs transition-colors sm:px-3 sm:text-sm',
                    active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="hidden h-3.5 w-3.5 sm:block" />
                  {domain.label}
                  {active ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" /> : null}
                </Link>
              )
            })}
          </nav>

          {subNav ? (
            <nav aria-label="当前业务域子页" className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto border-t">
              {subNav.map((item) => {
                const active = isActive(pathname, item.to)
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    data-active={active ? 'true' : 'false'}
                    className={cn(
                      'inline-flex min-h-[36px] shrink-0 items-center px-2.5 text-[11px] transition-colors sm:text-xs',
                      active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          ) : null}
        </div>
      </header>
      <Outlet />
    </div>
  )
}
