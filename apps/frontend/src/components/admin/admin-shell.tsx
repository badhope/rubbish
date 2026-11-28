import { Link, Outlet, useLocation } from '@tanstack/react-router'
import {
  FileText,
  Gauge,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'

/** 后台统一壳：总览 + 四个业务域共用一条页签；旧刊期口径不再暴露为后台入口。 */
const DOMAINS = [
  { key: 'overview', label: '总览', to: '/admin', icon: Gauge, paths: ['/admin'] },
  {
    key: 'people',
    label: '成员管理',
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
  { key: 'economy', label: '经验', to: '/admin/economy', icon: Wallet, paths: ['/admin/economy'] },
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
    <div className="w-full" data-admin-shell>
      <header className="border-b bg-background/95">
        <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 pt-4">
            <div className="font-serif text-lg tracking-tight sm:text-xl">管理后台</div>
            <p className="hidden max-w-[260px] text-right text-[11px] leading-relaxed text-muted-foreground sm:block">
              成员、内容、经验、系统，各管一摊。能在这里处理，不用来回跳页。
            </p>
          </div>

          <nav aria-label="后台业务域" className="-mx-1 mt-3 flex flex-wrap gap-1">
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
