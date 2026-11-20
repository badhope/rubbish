import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CheckCheck, ChevronDown, Coins } from 'lucide-react'
import { toast } from 'sonner'
import { useCheckin, useWallet } from '@/hooks/api/use-currency'
import { Button } from '@/components/ui/button'
import { extractError } from '@/lib/utils'
import { formatCoins, shortDateTime } from './format'

function SectionTitle({
  kicker,
  title,
  hint,
  action,
}: {
  kicker: string
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{kicker}</p>
        <h2 className="mt-1 font-serif text-xl tracking-tight">{title}</h2>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function MePoints() {
  const wallet = useWallet()
  const checkin = useCheckin()
  const [showLedger, setShowLedger] = useState(false)

  const onCheckin = async () => {
    try {
      const result = await checkin.mutateAsync()
      if (result.checked_in_today) toast.success('签到成功，积分已到账')
      else toast.info('今天已经签到过了')
    } catch (err) {
      toast.error(extractError(err, '签到失败'))
    }
  }

  return (
    <div className="space-y-9">
      <section>
        <SectionTitle
          kicker="BALANCE"
          title="积分"
          hint="积分只记录社区贡献：无现金价值，不提供兑换、充值或转让。日常收入有上限，不鼓励刷量。"
        />
        <div className="grid gap-4 border-y py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="font-serif text-4xl leading-none tracking-tight text-primary">
              {formatCoins(wallet.data?.balance)}
              <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">积分</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              累计获得 {formatCoins(wallet.data?.total_earned)} 积分
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>今日收入上限 {wallet.data?.daily_earn_cap ?? 5} 积分</span>
              <span>本月全站已发 {wallet.data?.monthly_issued ?? 0} / {wallet.data?.monthly_issue_cap ?? 5000} 积分</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {wallet.data?.checked_in_today ? (
              <span className="inline-flex h-9 items-center gap-1.5 border bg-muted/30 px-3 text-sm text-muted-foreground">
                <CheckCheck className="h-3.5 w-3.5" />
                今日已签到
              </span>
            ) : (
              <Button size="sm" onClick={() => void onCheckin()} disabled={checkin.isPending}>
                <Coins className="h-3.5 w-3.5" />
                {checkin.isPending ? '签到中…' : '签到领积分'}
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/guide" search={{ tab: 'help' }}>
                积分说明
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle
          kicker="LEDGER"
          title="积分流水"
          hint="只展示最近记录；完整流水以服务端为准。"
          action={
            <Button variant="ghost" size="sm" onClick={() => setShowLedger((value) => !value)}>
              {showLedger ? '收起' : `展开 ${wallet.data?.recent.length ?? 0} 条`}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showLedger ? 'rotate-180' : ''}`} />
            </Button>
          }
        />
        {!showLedger ? null : (wallet.data?.recent.length ?? 0) === 0 ? (
          <p className="border-y py-5 text-sm text-muted-foreground">还没有积分记录。</p>
        ) : (
          <ul className="divide-y border-y">
            {wallet.data?.recent.map((event, index) => (
              <li key={`${event.reason}-${index}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0 truncate">
                  {event.label}
                  {event.note ? <span className="text-muted-foreground"> · {event.note}</span> : null}
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    {shortDateTime(event.created_at)}
                  </span>
                </span>
                <span className={`shrink-0 font-mono text-xs ${event.delta > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                  {event.delta > 0 ? '+' : ''}{event.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
