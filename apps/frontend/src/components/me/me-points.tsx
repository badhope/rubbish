import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CheckCheck, ChevronDown, Coins, Gift, ShoppingBag } from 'lucide-react'
import { toast } from 'sonner'
import { useCheckin, useWallet } from '@/hooks/api/use-currency'
import { useMyPurchases, usePurchaseItem, useShopItems } from '@/hooks/api/use-shop'
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
  const items = useShopItems()
  const purchases = useMyPurchases()
  const buy = usePurchaseItem()
  const [showLedger, setShowLedger] = useState(false)
  const [buyingId, setBuyingId] = useState<number | null>(null)

  const onCheckin = async () => {
    try {
      const result = await checkin.mutateAsync()
      if (result.checked_in_today) toast.success('签到成功，积分已到账')
      else toast.info('今天已经签到过了')
    } catch (err) {
      toast.error(extractError(err, '签到失败'))
    }
  }

  const onBuy = async (id: number, name: string) => {
    setBuyingId(id)
    try {
      const result = await buy.mutateAsync(id)
      toast.success(`已兑换「${name}」${result.note ? `：${result.note}` : ''}`)
    } catch (err) {
      toast.error(extractError(err, '兑换失败'))
    } finally {
      setBuyingId(null)
    }
  }

  return (
    <div className="space-y-9">
      <section>
        <SectionTitle
          kicker="BALANCE"
          title="积分"
          hint="积分只记录社区贡献：无现金价值，不能充值或转让；可以在下面的积分商店兑换站内虚拟权益。日常收入有上限，不鼓励刷量。"
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
          kicker="SHOP"
          title="积分商店"
          hint="只兑换站内虚拟权益，不涉及现金、充值和实物；自动权益即时生效，人工权益由管理员在站内处理。"
          action={<span className="font-mono text-xs text-muted-foreground">{items.data?.length ?? 0} 件</span>}
        />
        {items.isLoading ? <p className="border-y py-6 text-sm text-muted-foreground">加载中…</p> : null}
        {!items.isLoading && (items.data?.length ?? 0) === 0 ? (
          <p className="border-y py-6 text-sm text-muted-foreground">商店暂时没有上架权益。</p>
        ) : null}
        {(items.data?.length ?? 0) > 0 ? (
          <div className="divide-y border-y">
            {items.data?.map((item) => {
              const soldOut = item.stock !== null && item.stock <= 0
              const insufficient = (wallet.data?.balance ?? 0) < item.price_coin
              return (
                <div key={item.id} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border bg-muted/25 text-muted-foreground">
                      <Gift className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {item.name}
                        {item.effect === 'accent_unlock' ? (
                          <span className="ml-2 text-[10px] font-normal text-primary">自动生效</span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description || '暂无说明'}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold text-primary">{formatCoins(item.price_coin)} 积分</p>
                      <p className="text-[10px] text-muted-foreground">
                        {item.stock === null ? '不限量' : soldOut ? '已售罄' : `剩 ${item.stock} 件`}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={soldOut ? 'outline' : 'default'}
                      disabled={soldOut || insufficient || buyingId === item.id}
                      onClick={() => void onBuy(item.id, item.name)}
                    >
                      <ShoppingBag className="h-3.5 w-3.5" />
                      {soldOut ? '已售罄' : insufficient ? '积分不足' : buyingId === item.id ? '兑换中…' : '兑换'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {(purchases.data?.length ?? 0) > 0 ? (
          <div className="border-b py-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">最近兑换</p>
            <ul className="divide-y">
              {purchases.data?.slice(0, 5).map((purchase) => (
                <li key={purchase.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                  <span>{purchase.item_name}</span>
                  <span className="text-muted-foreground">
                    {purchase.note ||
                      ({ paid: '待管理员处理', fulfilled: '已生效', rejected: '已驳回' }[purchase.status] ??
                        purchase.status)}
                  </span>
                  <span className="font-mono text-primary">-{formatCoins(purchase.price_coin)} 积分</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
