import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CheckCheck, Coins, Gift, QrCode, ShoppingBag, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  useMyPurchases,
  usePurchaseItem,
  useShopExchange,
  useShopItems,
} from '@/hooks/api/use-shop'
import { useCheckin, useWallet } from '@/hooks/api/use-currency'
import type { MeProfile } from '@/hooks/api/use-modules'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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

export function MeCoins({ profile }: { profile: MeProfile }) {
  const wallet = useWallet()
  const checkin = useCheckin()
  const items = useShopItems()
  const purchases = useMyPurchases()
  const exchange = useShopExchange()
  const buy = usePurchaseItem()
  const [buyingId, setBuyingId] = useState<number | null>(null)
  const [showAllShop, setShowAllShop] = useState(false)

  const ownedIdentities = profile.identities.filter((identity) => identity in profile.levels)

  const onCheckin = async () => {
    try {
      const result = await checkin.mutateAsync()
      if (result.checked_in_today) toast.success('签到成功，R 币已到账')
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
          title="R 币"
          hint="站内货币；100 R 对应 1 元购买力。日常收入有上限，不鼓励刷量。"
        />
        <div className="grid gap-4 border-y py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="font-serif text-4xl leading-none tracking-tight text-primary">
              {formatCoins(wallet.data?.balance)}
              <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">R</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              约 ¥{wallet.data?.balance_yuan?.toFixed(2) ?? '0.00'} · 累计获得 {formatCoins(wallet.data?.total_earned)} R
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>今日收入上限 {wallet.data?.daily_earn_cap ?? 5} R</span>
              <span>本月全站已发 {wallet.data?.monthly_issued ?? 0} / {wallet.data?.monthly_issue_cap ?? 5000} R</span>
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
                {checkin.isPending ? '签到中…' : '签到领 R'}
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/guide" search={{ tab: 'levels' }}>
                等级与规则
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle
          kicker="SHOP"
          title="可兑换"
          hint="兑换后直接扣 R；库存与价格由主编配置。"
          action={
            <span className="font-mono text-xs text-muted-foreground">
              {items.data?.length ?? 0} 件
            </span>
          }
        />
        {items.isLoading ? <p className="border-y py-6 text-sm text-muted-foreground">加载货架…</p> : null}
        {!items.isLoading && (items.data?.length ?? 0) === 0 ? (
          <p className="border-y py-6 text-sm text-muted-foreground">商城还没有上架货品。</p>
        ) : null}
        {(items.data?.length ?? 0) > 0 ? (
          <div className="divide-y border-y">
            {(showAllShop ? items.data : items.data?.slice(0, 4))?.map((item) => {
              const soldOut = item.stock !== null && item.stock <= 0
              const insufficient = (wallet.data?.balance ?? 0) < item.price_coin
              return (
                <div key={item.id} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center border bg-muted/25 text-muted-foreground">
                      <Gift className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{item.name}</p>
                        {item.effect === 'accent_unlock' ? (
                          <Badge variant="secondary" className="rounded-none gap-1 text-[10px]">
                            <Sparkles className="h-3 w-3" /> 自动生效
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {item.description || '暂无说明'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-4 sm:justify-end">
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold text-primary">{formatCoins(item.price_coin)} R</p>
                      <p className="text-[10px] text-muted-foreground">
                        {item.stock === null ? '不限量' : soldOut ? '已售罄' : `剩 ${item.stock} 件`}
                      </p>
                    </div>
                    <Button
                      variant={soldOut ? 'outline' : 'default'}
                      size="sm"
                      disabled={soldOut || insufficient || buyingId === item.id}
                      onClick={() => void onBuy(item.id, item.name)}
                    >
                      <ShoppingBag className="h-3.5 w-3.5" />
                      {soldOut ? '已售罄' : insufficient ? 'R 不足' : buyingId === item.id ? '兑换中…' : '兑换'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {(items.data?.length ?? 0) > 4 ? (
          <button
            type="button"
            onClick={() => setShowAllShop((value) => !value)}
            className="mt-2 text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
          >
            {showAllShop ? '收起货架' : `展开全部 ${items.data?.length ?? 0} 件`}
          </button>
        ) : null}
        {(purchases.data?.length ?? 0) > 0 ? (
          <div className="border-b py-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">最近兑换</p>
            <ul className="divide-y">
              {purchases.data?.slice(0, 5).map((purchase) => (
                <li key={purchase.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                  <span>{purchase.item_name}</span>
                  <span className="text-muted-foreground">{purchase.note || purchase.status}</span>
                  <span className="font-mono text-primary">-{formatCoins(purchase.price_coin)} R</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {exchange.data?.enabled ? (
        <section>
          <SectionTitle
            kicker="EXCHANGE"
            title="兑现"
            hint="按主编配置的方式申请；付款前核对账户，不要向任何人提供验证码或密码。"
          />
          <div className="flex flex-wrap items-start gap-4 border-y py-4">
            <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <p>
                比例 <strong>{exchange.data.coin_per_yuan} R = ¥1</strong> · 最低 <strong>{exchange.data.min_coin} R</strong> 起兑
              </p>
              {exchange.data.method ? <p className="text-muted-foreground">方式：{exchange.data.method}</p> : null}
              {exchange.data.account ? <p>账户 / 联系人：{exchange.data.account}</p> : null}
              {exchange.data.note ? (
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{exchange.data.note}</p>
              ) : null}
            </div>
            {exchange.data.qr_url ? (
              <img
                src={exchange.data.qr_url}
                alt="主编配置的收款码"
                className="h-24 w-24 border bg-white object-contain p-1"
              />
            ) : null}
          </div>
        </section>
      ) : null}

      <section>
        <SectionTitle
          kicker="LEVELS"
          title="身份等级"
          hint="等级只在同一身份内累计；不跨身份比较，也不兑换权限。"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/guide" search={{ tab: 'levels' }}>
                完整等级表
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          }
        />
        {ownedIdentities.length === 0 ? (
          <p className="border-y py-5 text-sm text-muted-foreground">
            {profile.permission_role === 'editor_in_chief'
              ? '主编为最高权限档，不参与等级轨。'
              : '暂无等级轨。投稿或认领通过后会开始累计。'}
          </p>
        ) : (
          <div className="divide-y border-y">
            {ownedIdentities.map((identity) => {
              const level = profile.levels[identity]
              const pct = Math.max(0, Math.min(1, level.progress))
              return (
                <div key={identity} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-6 min-w-11 items-center justify-center border border-primary/25 bg-primary/10 px-2 font-mono text-xs font-semibold text-primary">
                        {level.level_label}
                      </span>
                      <span className="text-sm font-medium">{level.identity_name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{level.points} 分</span>
                    </div>
                    <div className="mt-2 h-1 w-full max-w-sm overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct * 100}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {level.next_threshold === null
                        ? '已达当前身份最高等级'
                        : `距下一级还差 ${level.to_next} 分（${level.next_threshold} 分升级）`}
                    </p>
                  </div>
                  <Link
                    to="/me"
                    search={{ tab: 'coins' }}
                    className="hidden text-xs text-muted-foreground hover:text-primary sm:block"
                  >
                    查看流水
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <SectionTitle kicker="LEDGER" title="R 币流水" hint="只展示最近记录；完整流水以服务端为准。" />
        {(wallet.data?.recent.length ?? 0) === 0 ? (
          <p className="border-y py-5 text-sm text-muted-foreground">还没有 R 币记录。</p>
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
