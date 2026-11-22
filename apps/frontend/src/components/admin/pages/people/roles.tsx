import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock3, UserRoundCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { extractError } from '@/lib/utils'
import type { AdminRoleApplications, RoleApplicationItem } from '@/lib/types'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/common/state'
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
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected'

const ROLE_LABELS: Record<string, string> = {
  reviewer: '互评成员',
  senior_reviewer: '资深互评成员',
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: '全部',
  pending: '待处理',
  approved: '已通过',
  rejected: '已驳回',
}

function dateText(value: string) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { hour12: false })
}

function statusBadge(status: RoleApplicationItem['status']) {
  if (status === 'approved') return <Badge className="bg-emerald-600">已通过</Badge>
  if (status === 'rejected') return <Badge variant="destructive">已驳回</Badge>
  return <Badge variant="secondary">待处理</Badge>
}

export default function RolesPage({ highlightApplicationId }: { highlightApplicationId?: number }) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [target, setTarget] = useState<{ item: RoleApplicationItem; decision: 'approve' | 'reject' } | null>(null)
  const [note, setNote] = useState('')
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const applied = useRef(0)
  const qc = useQueryClient()

  const query = useQuery<AdminRoleApplications>({
    queryKey: ['admin', 'role-applications'],
    queryFn: async () =>
      (await api.get('/gamification/admin/applications', { params: { page_size: 100 } })).data,
  })

  const decide = useMutation({
    mutationFn: async (payload: { id: number; decision: 'approve' | 'reject'; note: string }) =>
      (
        await api.post(`/gamification/admin/applications/${payload.id}/decision`, {
          decision: payload.decision,
          note: payload.note || undefined,
        })
      ).data,
    onSuccess: (_data, payload) => {
      toast.success(payload.decision === 'approve' ? '已通过申请并授予身份' : '已驳回申请')
      setTarget(null)
      setNote('')
      void qc.invalidateQueries({ queryKey: ['admin', 'role-applications'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'role-applications', 'pending-count'] })
    },
    onError: (err) => toast.error(extractError(err, '操作失败')),
  })

  const items = useMemo(() => query.data?.data ?? [], [query.data])
  const visible = filter === 'all' ? items : items.filter((item) => item.status === filter)
  const pendingCount = items.filter((item) => item.status === 'pending').length

  useEffect(() => {
    if (!highlightApplicationId || applied.current === highlightApplicationId) return
    const hit = items.find((item) => item.id === highlightApplicationId)
    if (!hit) return
    applied.current = highlightApplicationId
    setFilter('all')
    setHighlightId(highlightApplicationId)
    window.setTimeout(() => {
      document.getElementById(`role-application-admin-${highlightApplicationId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 0)
  }, [highlightApplicationId, items])

  return (
    <div>
      <PageHeader
        title="角色申请"
        description="互评成员和资深互评成员由这里审批；通过后身份立即生效，对方会收到通知。"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? 'default' : 'outline'}
            onClick={() => setFilter(key)}
          >
            {STATUS_LABELS[key]}
            {key === 'pending' && pendingCount > 0 ? (
              <span className="ml-1 rounded-full bg-background/20 px-1.5 font-mono text-[10px]">{pendingCount}</span>
            ) : null}
          </Button>
        ))}
      </div>

      {query.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState message="加载角色申请失败" onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={filter === 'pending' ? '没有待处理的角色申请' : '暂无记录'}
          description="作者达到门槛后可自行提交申请；通过后身份立即生效。"
        />
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <Card
              id={`role-application-admin-${item.id}`}
              key={item.id}
              className={cn(
                'transition-shadow',
                item.status === 'pending' ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-emerald-500',
                highlightId === item.id && 'ring-2 ring-primary/60 ring-offset-2',
              )}
            >
              <CardContent className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  {statusBadge(item.status)}
                  <Badge variant="outline">{ROLE_LABELS[item.target_role] ?? item.target_role}</Badge>
                  <span className="text-sm font-medium">{item.username ?? `用户 #${item.user_id}`}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{dateText(item.created_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.statement}</p>
                {item.decision_note ? (
                  <p className="mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed">
                    处理说明：{item.decision_note}
                  </p>
                ) : null}
                {item.status === 'pending' ? (
                  <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                    <Button
                      size="sm"
                      onClick={() => {
                        setTarget({ item, decision: 'approve' })
                        setNote('')
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      通过
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTarget({ item, decision: 'reject' })
                        setNote('')
                      }}
                    >
                      <XCircle className="h-4 w-4" />
                      驳回
                    </Button>
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      等待 {item.username ?? '申请人'} 的资格与说明
                    </span>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {target?.decision === 'approve' ? '通过这份申请？' : '驳回这份申请'}
            </DialogTitle>
            <DialogDescription>
              {target?.decision === 'approve'
                ? `通过后，${target?.item.username ?? '申请人'}会立即获得“${ROLE_LABELS[target?.item.target_role ?? ''] ?? target?.item.target_role}”身份。`
                : '建议写一句原因，申请人会在通知里看到。'}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder={target?.decision === 'approve' ? '可选：欢迎或说明接下来做什么' : '例：互评说明太笼统，请补充具体方向后再申请。'}
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">{note.length} / 500</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={decide.isPending}>
              取消
            </Button>
            <Button
              variant={target?.decision === 'reject' ? 'destructive' : 'default'}
              disabled={decide.isPending || (target?.decision === 'reject' && note.trim().length === 0)}
              onClick={() => {
                if (!target) return
                decide.mutate({ id: target.item.id, decision: target.decision, note: note.trim() })
              }}
            >
              <UserRoundCheck className="h-4 w-4" />
              {target?.decision === 'approve' ? '确认通过' : '确认驳回'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
