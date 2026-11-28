import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearch } from '@tanstack/react-router'
import { ArrowUpRight, BadgeCheck, Clock3, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { extractError } from '@/lib/utils'
import type { MyRoleApplications, RoleApplicationItem } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

const ROLE_LABELS: Record<string, string> = {
  reviewer: '互评成员',
  senior_reviewer: '资深互评成员',
}

function statusBadge(status: RoleApplicationItem['status']) {
  if (status === 'approved') {
    return <Badge className="bg-emerald-500/15 text-emerald-700">已通过</Badge>
  }
  if (status === 'rejected') return <Badge variant="destructive">未通过</Badge>
  return <Badge variant="secondary">处理中</Badge>
}

function formatDay(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-CN')
}

export function RoleApplicationPanel() {
  const qc = useQueryClient()
  const search = useSearch({ strict: false }) as { application?: number | string }
  const linkedId = Number(search.application ?? 0)
  const applied = useRef(0)
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const [targetRole, setTargetRole] = useState<'reviewer' | 'senior_reviewer' | null>(null)
  const [statement, setStatement] = useState('')

  const query = useQuery<MyRoleApplications>({
    queryKey: ['gamification', 'applications', 'me'],
    queryFn: async () => (await api.get('/gamification/applications/me')).data,
  })

  const submit = useMutation({
    mutationFn: async (payload: { target_role: 'reviewer' | 'senior_reviewer'; statement: string }) =>
      (await api.post<RoleApplicationItem>('/gamification/applications', payload)).data,
    onSuccess: () => {
      toast.success('申请已提交，等站务组处理')
      setTargetRole(null)
      setStatement('')
      void qc.invalidateQueries({ queryKey: ['gamification', 'applications', 'me'] })
    },
    onError: (err) => toast.error(extractError(err, '提交申请失败')),
  })

  const items = useMemo(() => query.data?.applications ?? [], [query.data])

  useEffect(() => {
    if (!linkedId || applied.current === linkedId) return
    const hit = items.find((item) => item.id === linkedId)
    if (!hit) return
    applied.current = linkedId
    setHighlightId(linkedId)
    window.setTimeout(() => {
      document.getElementById(`role-application-${linkedId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 0)
  }, [linkedId, items])

  if (query.isLoading) {
    return (
      <section id="role-applications" className="rounded-md border bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
        正在读取你的申请资格…
      </section>
    )
  }
  if (query.isError || !query.data) {
    return (
      <section id="role-applications" className="rounded-md border border-destructive/20 px-4 py-5 text-sm text-destructive">
        申请资格加载失败。
        <Button variant="link" size="sm" onClick={() => void query.refetch()}>
          重试
        </Button>
      </section>
    )
  }

  const { reviewer, senior_reviewer: senior } = query.data.eligibility
  const pendingReviewer = items.some((item) => item.target_role === 'reviewer' && item.status === 'pending')
  const pendingSenior = items.some((item) => item.target_role === 'senior_reviewer' && item.status === 'pending')

  const reviewerReason = reviewer.already_role
    ? '你已经拥有这个身份。'
    : pendingReviewer
      ? '上次申请还在处理中，不用重复提交。'
      : reviewer.eligible
        ? '资格够了，可以提交申请；站务组会看你的作品和说明。'
        : `门槛还差一点：至少 1 篇作品通过；你目前通过 ${reviewer.accepted_papers} 篇。`

  const seniorReason = senior.already_role
    ? '你已经拥有这个身份。'
    : pendingSenior
      ? '上次申请还在处理中，不用重复提交。'
      : !senior.has_reviewer_role
        ? '要申请资深互评成员，得先成为互评成员。'
        : senior.eligible
          ? '资格够了，可以提交申请。'
          : `门槛还差一点：完成 ${senior.thresholds.reviews_completed} 份互评；你目前完成 ${senior.reviews_completed} 份。`

  const canApply = (role: 'reviewer' | 'senior_reviewer') => {
    if (role === 'reviewer') {
      return reviewer.eligible && !reviewer.already_role && !pendingReviewer
    }
    return senior.eligible && !senior.already_role && !pendingSenior
  }

  return (
    <section id="role-applications" className="space-y-4">
      <div>
        <h2 className="font-serif text-xl font-semibold">申请内容工作身份</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          互评成员和资深互评成员可以申请；站点管理身份不开放申请，由站务组直接任命。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {([
          { role: 'reviewer' as const, title: '互评成员', reason: reviewerReason, apply: canApply('reviewer'), already: reviewer.already_role, pending: pendingReviewer },
          { role: 'senior_reviewer' as const, title: '资深互评成员', reason: seniorReason, apply: canApply('senior_reviewer'), already: senior.already_role, pending: pendingSenior },
        ]).map((item) => (
          <Card key={item.role} className="h-full">
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{item.title}</p>
                {item.already ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700">
                    <BadgeCheck className="mr-1 h-3 w-3" />
                    已拥有
                  </Badge>
                ) : item.pending ? (
                  <Badge variant="secondary">
                    <Clock3 className="mr-1 h-3 w-3" />
                    处理中
                  </Badge>
                ) : null}
              </div>
              <p className="flex-1 text-xs leading-relaxed text-muted-foreground">{item.reason}</p>
              {item.already ? (
                <Button size="sm" variant="outline" asChild>
                  <Link to="/review" search={{ tab: 'board' }}>
                    去互评台
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant={item.apply ? 'default' : 'outline'}
                  disabled={!item.apply}
                  onClick={() => {
                    setTargetRole(item.role)
                    setStatement('')
                  }}
                >
                  <PenLine className="h-3.5 w-3.5" />
                  {item.pending ? '等待处理' : item.apply ? '写申请' : '暂未达到门槛'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {items.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">我的申请记录</h3>
          {items.map((item) => (
            <div
              id={`role-application-${item.id}`}
              key={item.id}
              className={[
                'rounded-md border bg-card p-3 text-sm transition-shadow',
                highlightId === item.id ? 'ring-2 ring-primary/60 ring-offset-2' : '',
              ].join(' ')}
            >
              <div className="flex flex-wrap items-center gap-2">
                {statusBadge(item.status)}
                <span className="font-medium">{ROLE_LABELS[item.target_role] ?? item.target_role}</span>
                <span className="text-xs text-muted-foreground">{formatDay(item.created_at)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.statement}</p>
              {item.decision_note ? (
                <p className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs leading-relaxed">
                  站务说明：{item.decision_note}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">还没有申请记录。达到门槛后，上面的按钮会亮起来。</p>
      )}

      <Dialog open={targetRole !== null} onOpenChange={(open) => !open && setTargetRole(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>申请{targetRole ? ROLE_LABELS[targetRole] : ''}</DialogTitle>
            <DialogDescription>
              写清你为什么想参与互评、能看哪些方向。至少 20 字，站务组会据此判断。
            </DialogDescription>
          </DialogHeader>
          <p className="-mt-1 rounded-md border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            提交前建议先在
            <Link to="/me" search={{ tab: 'settings', section: 'profile' }} className="mx-1 text-primary hover:underline">
              资料页
            </Link>
            填好「审稿人领域」和「审稿能力标签」。站务审批时会一并看这些方向，进互评台后也按它们匹配稿件。
          </p>
          <div>
            <Textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              rows={7}
              maxLength={2000}
              placeholder="例：我发布过 3 篇通过的作品，主要写教育和技术；愿意每周看 1–2 篇，给出具体修改建议。"
            />
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>至少 20 字，最多 2000 字</span>
              <span>{statement.trim().length} / 2000</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTargetRole(null)} disabled={submit.isPending}>
              取消
            </Button>
            <Button
              disabled={submit.isPending || statement.trim().length < 20}
              onClick={() => {
                if (!targetRole) return
                submit.mutate({ target_role: targetRole, statement: statement.trim() })
              }}
            >
              提交申请
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
