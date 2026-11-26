import { useEffect, useState } from 'react'
import { Check, Coins, Gift, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  useCoinConfig,
  useUpdateCoinPolicy,
  useUpdateCoinRule,
} from '@/hooks/api/use-coin-config'
import {
  useAdminShopPurchases,
  useDecideShopPurchase,
} from '@/hooks/api/use-shop'
import type { AdminShopPurchase, ShopPurchaseStatus } from '@/hooks/api/use-shop'
import { extractError } from '@/lib/utils'
import { ShopCatalogCard } from '@/components/admin/pages/economy/shop-catalog'
import { PageHeader } from '@/components/common/page-header'
import { Loading } from '@/components/common/state'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const PURCHASE_TABS: Array<{ key: ShopPurchaseStatus; label: string }> = [
  { key: 'paid', label: '待履约' },
  { key: 'fulfilled', label: '已完成' },
  { key: 'rejected', label: '已驳回' },
]

const PURCHASE_STATUS_LABEL: Record<ShopPurchaseStatus, string> = {
  paid: '待履约',
  fulfilled: '已完成',
  rejected: '已驳回',
}

export default function AdminPointsPage() {
  const config = useCoinConfig()
  const updateRule = useUpdateCoinRule()
  const updatePolicy = useUpdateCoinPolicy()
  const [purchaseStatus, setPurchaseStatus] = useState<ShopPurchaseStatus>('paid')
  const purchases = useAdminShopPurchases(purchaseStatus)
  const decidePurchase = useDecideShopPurchase()
  const [decisionTarget, setDecisionTarget] = useState<{
    purchase: AdminShopPurchase
    status: 'fulfilled' | 'rejected'
  } | null>(null)
  // 旧互评、发布与处理决定和零额度回复不再占界面；只保留社区当前四类动作。
  const currentReasons = new Set(['checkin.daily', 'checkin.weekly_bonus', 'forum.topic', 'claim.approve'])
  const rules = config.data?.rules.filter((rule) => currentReasons.has(rule.reason)) ?? []

  const [policy, setPolicy] = useState({ daily_earn_cap: 5, monthly_issue_cap: 5000 })
  const [ruleEdits, setRuleEdits] = useState<Record<string, { amount: number; daily_cap: number; is_active: boolean }>>({})

  useEffect(() => {
    if (!config.data) return
    setPolicy(config.data.policy)
    const next: Record<string, { amount: number; daily_cap: number; is_active: boolean }> = {}
    for (const rule of config.data.rules) {
      next[rule.reason] = { amount: rule.amount, daily_cap: rule.daily_cap, is_active: rule.is_active }
    }
    setRuleEdits(next)
  }, [config.data])

  const savePolicy = async () => {
    try {
      await updatePolicy.mutateAsync(policy)
      toast.success('发放口径已保存')
    } catch (err) {
      toast.error(extractError(err, '保存失败'))
    }
  }

  const saveRule = async (reason: string) => {
    const value = ruleEdits[reason]
    if (!value) return
    try {
      await updateRule.mutateAsync({ reason, ...value })
      toast.success('发放规则已保存')
    } catch (err) {
      toast.error(extractError(err, '保存失败'))
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="经验与货品"
        description="经验是社区贡献值：无现金价值、不可充值、不可转让。这里管理发放口径、兑换货品和人工履约。"
      />

      <ShopCatalogCard />

      {config.isLoading ? <Loading /> : null}

      {config.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4" /> 发放口径
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>日常收入每日上限（经验）</Label>
                <Input type="number" min={1} value={policy.daily_earn_cap} onChange={(e) => setPolicy({ ...policy, daily_earn_cap: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>全站每月发放上限（经验）</Label>
                <Input type="number" min={1} value={policy.monthly_issue_cap} onChange={(e) => setPolicy({ ...policy, monthly_issue_cap: Number(e.target.value) })} />
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              每日上限只约束签到、发帖等日常收入；优质内容、社区贡献等一次性奖励另计，但仍计入全站月发放上限。
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                本月已发 {config.data.monthly_issued} 经验。
                超过月度上限后所有发放自动暂停。
              </p>
              <Button size="sm" onClick={() => void savePolicy()} disabled={updatePolicy.isPending}>
                <Save className="h-4 w-4" /> 保存发放口径
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gift className="h-4 w-4" /> 兑换履约
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1 border-b pb-2">
            {PURCHASE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setPurchaseStatus(tab.key)}
                data-active={purchaseStatus === tab.key ? 'true' : 'false'}
                className={`min-h-8 border px-2.5 text-xs transition-colors ${
                  purchaseStatus === tab.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {purchaseStatus === 'paid'
              ? '只处理人工权益：确认已远程处理后标记完成；无法履约则驳回并自动退回经验。自动生效的主题色不会出现在这里。'
              : purchaseStatus === 'fulfilled'
                ? '已完成的兑换记录：用于回看发货时间和处理备注；不会重复出现待履约操作。'
                : '已驳回的兑换记录：经验已退回，保留原因备查。'}
          </p>
          {purchases.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
          {!purchases.isLoading && (purchases.data?.length ?? 0) === 0 ? (
            <p className="border-y py-5 text-sm text-muted-foreground">
              没有{PURCHASE_STATUS_LABEL[purchaseStatus]}的人工兑换。
            </p>
          ) : null}
          {(purchases.data?.length ?? 0) > 0 ? (
            <div className="divide-y border-y">
              {purchases.data?.map((purchase) => (
                <div key={purchase.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {purchase.item_name}
                      <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                        -{purchase.price_coin} 经验
                      </span>
                      <Badge variant="outline" className="ml-2 align-middle">
                        {PURCHASE_STATUS_LABEL[purchase.status]}
                      </Badge>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {purchase.user.display_name || purchase.user.username || `用户 #${purchase.user.id}`} ·{' '}
                      {new Date(purchase.created_at).toLocaleString('zh-CN', { hour12: false })}
                    </p>
                    {purchase.note ? <p className="mt-1 text-xs text-muted-foreground">{purchase.note}</p> : null}
                  </div>
                  {purchase.status === 'paid' ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decidePurchase.isPending}
                        onClick={() => setDecisionTarget({ purchase, status: 'fulfilled' })}
                      >
                        <Check className="h-3.5 w-3.5" /> 完成
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decidePurchase.isPending}
                        onClick={() => setDecisionTarget({ purchase, status: 'rejected' })}
                      >
                        <X className="h-3.5 w-3.5" /> 驳回
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {config.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4" /> 每个动作发多少
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rules.map((rule) => {
              const edit = ruleEdits[rule.reason] ?? rule
              return (
                <div key={rule.reason} className="grid items-end gap-3 rounded-lg border p-3 sm:grid-cols-[1.4fr_0.8fr_0.8fr_auto]">
                  <div>
                    <p className="text-sm font-medium">{rule.label}</p>
                    <p className="text-xs text-muted-foreground">{rule.reason}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">每次发放</Label>
                    <Input type="number" min={0} value={edit.amount} onChange={(e) => setRuleEdits({ ...ruleEdits, [rule.reason]: { ...edit, amount: Number(e.target.value) } })} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">每日上限（0 = 不单限）</Label>
                    <Input type="number" min={0} value={edit.daily_cap} onChange={(e) => setRuleEdits({ ...ruleEdits, [rule.reason]: { ...edit, daily_cap: Number(e.target.value) } })} />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" checked={edit.is_active} onChange={(e) => setRuleEdits({ ...ruleEdits, [rule.reason]: { ...edit, is_active: e.target.checked } })} />
                      启用
                    </label>
                    <Button size="sm" variant="outline" onClick={() => void saveRule(rule.reason)} disabled={updateRule.isPending}>
                      保存
                    </Button>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={decisionTarget !== null}
        title={decisionTarget?.status === 'fulfilled' ? '确认完成履约？' : '确认驳回并退回经验？'}
        description={
          decisionTarget
            ? decisionTarget.status === 'fulfilled'
              ? `为「${decisionTarget.purchase.item_name}」标记完成，订单会进入已完成列表。`
              : `驳回「${decisionTarget.purchase.item_name}」，并退回 ${decisionTarget.purchase.price_coin} 经验。`
            : undefined
        }
        confirmText={decisionTarget?.status === 'fulfilled' ? '标记完成' : '驳回并退回'}
        destructive={decisionTarget?.status === 'rejected'}
        onConfirm={() => {
          const target = decisionTarget
          if (!target) return
          setDecisionTarget(null)
          decidePurchase.mutate(
            {
              id: target.purchase.id,
              status: target.status,
              note: target.status === 'fulfilled' ? '内容整理已标记处理' : '内容整理驳回，经验已退回',
            },
            {
              onSuccess: () => toast.success(target.status === 'fulfilled' ? '已标记完成' : '已驳回并退回经验'),
              onError: (err) =>
                toast.error(
                  extractError(
                    err,
                    target.status === 'fulfilled' ? '没能完成履约，可再试一次' : '没能驳回并退回经验，可再试一次',
                  ),
                ),
            },
          )
        }}
        onOpenChange={(open) => !open && setDecisionTarget(null)}
      />
    </div>
  )
}
