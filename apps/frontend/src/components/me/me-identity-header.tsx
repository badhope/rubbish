import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Coins, ExternalLink, Gauge, Pencil } from 'lucide-react'
import type { MeProfile } from '@/hooks/api/use-modules'
import type { UserResponse } from '@/lib/types'
import { useWallet } from '@/hooks/api/use-currency'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { roleLabel } from '@/lib/role-labels'

const ROLE_STYLE: Record<string, string> = {
  user: 'border-border bg-muted/40 text-foreground',
  reviewer: 'border-primary/25 bg-primary/10 text-primary',
  editor: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  editor_in_chief: 'border-primary bg-primary text-primary-foreground',
}

export function MeIdentityHeader({
  profile,
  account,
  compact = false,
}: {
  profile: MeProfile
  account?: UserResponse
  compact?: boolean
}) {
  const displayName = account?.display_name || account?.username || profile.username
  const initials = displayName.slice(0, 2).toUpperCase()
  const wallet = useWallet()

  if (compact) {
    return (
      <section className="flex min-w-0 items-center gap-3 border-b py-4">
        <Avatar className="h-10 w-10 shrink-0 border bg-muted/30">
          <AvatarImage src={account?.avatar_url ?? undefined} alt="" />
          <AvatarFallback className="font-serif text-sm">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="editorial-kicker text-[10px] tracking-[0.24em] text-muted-foreground">
            我的空间
          </p>
          <p className="truncate font-serif text-lg leading-tight">{displayName}</p>
        </div>
        <span className="ml-auto hidden font-mono text-[11px] text-muted-foreground sm:inline">
          @{profile.username}
        </span>
      </section>
    )
  }

  return (
    <section className="border-b pb-7 sm:pb-9">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar className="h-16 w-16 shrink-0 border bg-muted/30 sm:h-[72px] sm:w-[72px]">
            <AvatarImage src={account?.avatar_url ?? undefined} alt="" />
            <AvatarFallback className="font-serif text-xl">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="editorial-kicker text-[10px] tracking-[0.24em] text-muted-foreground">
              我的空间
            </p>
            <h1 className="mt-1 font-serif text-2xl leading-tight tracking-tight sm:text-3xl">
              {displayName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="max-w-full break-all font-mono text-xs">@{profile.username}</span>
              <Badge
                variant="outline"
                className={cn('rounded-none px-2 py-0.5 text-[11px]', ROLE_STYLE[profile.permission_role])}
              >
                {profile.permission_label || roleLabel(profile.permission_role)}
              </Badge>
              {profile.permission_role === 'editor_in_chief' && profile.permission_role_label ? (
                <span className="text-xs text-muted-foreground">
                  · {profile.permission_role_label}
                </span>
              ) : null}
              <Link
                to="/levels"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
              >
                <Gauge className="h-3.5 w-3.5" />
                档位 {profile.activity.level}
                <span className="text-[10px] text-muted-foreground">成长记录</span>
              </Link>
            </div>
            {account?.affiliation ? (
              <p className="mt-2 truncate text-xs text-muted-foreground">{account.affiliation}</p>
            ) : null}
            <div className="mt-3 flex max-w-md items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${Math.round((profile.activity.progress ?? 0) * 100)}%` }}
                />
              </div>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {profile.activity.next_threshold
                  ? `还差 ${profile.activity.to_next} 到下一档`
                  : '已满档'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-stretch gap-2">
          <Link
            to="/me"
            search={{ tab: 'points' }}
            className="desk-stat group flex min-w-[142px] items-center gap-3 border px-3 py-2.5 transition-colors hover:border-primary/40"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Coins className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                可用经验
              </span>
              <span className="block font-mono text-lg font-semibold leading-tight text-primary">
                {wallet.data ? wallet.data.balance.toLocaleString('zh-CN') : '—'}
              </span>
            </span>
            <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-primary" />
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/me" search={{ tab: 'settings' }}>
                <Pencil className="h-3.5 w-3.5" />
                编辑资料
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/u/$username" params={{ username: profile.username }}>
                <ExternalLink className="h-3.5 w-3.5" />
                公开主页
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
