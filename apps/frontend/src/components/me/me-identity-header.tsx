import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Coins, ExternalLink, Pencil } from 'lucide-react'
import type { MeProfile } from '@/hooks/api/use-modules'
import type { UserResponse } from '@/lib/types'
import { useWallet } from '@/hooks/api/use-currency'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCoins } from './format'

const IDENTITY_LABEL: Record<string, string> = {
  author: '作者',
  reviewer: '审稿人',
  editor: '编辑',
}

const ROLE_STYLE: Record<string, string> = {
  user: 'border-border bg-muted/40 text-foreground',
  reviewer: 'border-primary/25 bg-primary/10 text-primary',
  editor: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  editor_in_chief: 'border-primary bg-primary text-primary-foreground',
}

export function MeIdentityHeader({
  profile,
  account,
}: {
  profile: MeProfile
  account?: UserResponse
}) {
  const wallet = useWallet()
  const displayName = account?.display_name || account?.username || profile.username
  const initials = displayName.slice(0, 2).toUpperCase()
  const balance = wallet.data?.balance ?? account?.coin_balance

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
              MY DESK · 个人中心
            </p>
            <h1 className="mt-1 font-serif text-2xl leading-tight tracking-tight sm:text-3xl">
              {displayName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono text-xs">@{profile.username}</span>
              <Badge
                variant="outline"
                className={cn('rounded-none px-2 py-0.5 text-[11px]', ROLE_STYLE[profile.permission_role])}
              >
                {profile.permission_label}
              </Badge>
              {profile.identities.map((identity) => (
                <span key={identity} className="text-xs">
                  {IDENTITY_LABEL[identity] ?? identity}
                </span>
              ))}
            </div>
            {account?.affiliation ? (
              <p className="mt-2 truncate text-xs text-muted-foreground">{account.affiliation}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-stretch gap-2">
          <Link
            to="/me"
            search={{ tab: 'points' }}
            className="desk-stat group flex min-w-[132px] items-center gap-3 border px-3 py-2.5 transition-colors hover:border-primary/40"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Coins className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                POINTS
              </span>
              <span className="block font-mono text-lg font-semibold leading-tight text-primary">
                {formatCoins(balance)}
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
