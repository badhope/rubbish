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
import { useAuth } from '@/hooks/use-auth'

/** 后台统一壳：六个业务域共用一条页签，子页仍保留各自的表单与权限。 */
const DOMAINS = [
  { key: 'overview', label: '总览', to: '/admin', icon: Gauge, paths: ['/admin'] },
  {
    key: 'people',
    label: '用户',
    to: '/admin/people',
    icon: Users,
    paths: ['/admin/people'],
  },
  {
    key: 'content',
    label: '内容',
    to: '/admin/content',
    icon: FileText,
    paths: ['/admin/content'],
  },
  {
    key: 'journal',
    label: '期刊',
    to: '/admin/journal',
    icon: CalendarDays,
    paths: ['/admin/journal', '/admin/issues'],
  },
  { key: 'economy', label: '经济', to: '/admin/economy', icon: Wallet, paths: ['/admin/economy'] },
  {
    key: 'system',
    label: '系统',
    to: '/admin/system',
    icon: ShieldCheck,
    paths: ['/admin/system'],
  },
] as const

function isActive(pathname: string, path: string) {
  return pathname === path || (path !== '/admin' && pathname.startsWith(`${path}/`))
}

export function AdminShell() {
  const pathname = useLocation({ select: (state) => state.pathname })
  const { user, isAdmin } = useAuth()
  const roles = user?.roles ?? []
  const canEconomy =
    isAdmin || roles.some((role) => ['chief_editor', 'deputy_editor', 'editor_in_chief', 'shop_manager'].includes(role))
  const visibleDomains = isAdmin
    ? DOMAINS
    : DOMAINS.filter((domain) => domain.key === 'economy' && canEconomy)
  const activeDomain = visibleDomains.find((domain) => domain.paths.some((path) => isActive(pathname, path)))

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
              按业务域切换，子段在同一页内切换；权限、审计和分页共用一套规则。
            </p>
          </div>

          <nav aria-label="后台业务域" className="scrollbar-none -mx-1 mt-3 flex gap-1 overflow-x-auto">
            {visibleDomains.map((domain) => {
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

        </div>
      </header>
      <Outlet />
    </div>
  )
}
