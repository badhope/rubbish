import { useEffect, useState } from 'react'
import { Coins, Save } from 'lucide-react'
import { toast } from 'sonner'
import {
  useCoinConfig,
  useUpdateCoinPolicy,
  useUpdateCoinRule,
} from '@/hooks/api/use-coin-config'
import { extractError } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { Loading } from '@/components/common/state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function AdminPointsPage() {
  const config = useCoinConfig()
  const updateRule = useUpdateCoinRule()
  const updatePolicy = useUpdateCoinPolicy()
  // 旧审稿、投稿、编辑裁决和零额度回复不再占界面；只保留社区当前四类动作。
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
        title="积分规则"
        description="积分是社区贡献值：无现金价值、不可充值、不可转让。只保留签到、发帖、认领通过这几类社区动作。"
      />

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
                <Label>日常收入每日上限（积分）</Label>
                <Input type="number" min={1} value={policy.daily_earn_cap} onChange={(e) => setPolicy({ ...policy, daily_earn_cap: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label>全站每月发放上限（积分）</Label>
                <Input type="number" min={1} value={policy.monthly_issue_cap} onChange={(e) => setPolicy({ ...policy, monthly_issue_cap: Number(e.target.value) })} />
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              每日上限只约束签到、发帖等日常收入；优质内容、社区贡献等一次性奖励另计，但仍计入全站月发放上限。
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                本月已发 {config.data.monthly_issued} 积分。
                超过月度上限后所有发放自动暂停。
              </p>
              <Button size="sm" onClick={() => void savePolicy()} disabled={updatePolicy.isPending}>
                <Save className="h-4 w-4" /> 保存发放口径
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
    </div>
  )
}
