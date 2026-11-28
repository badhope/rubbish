import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, Clock3, UserRoundCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useDisciplines } from '@/hooks/api/use-modules'
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

const PAGE_SIZE = 20

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

export default function RolesPage({
  highlightApplicationId,
  onClearHighlight,
}: {
  highlightApplicationId?: number
  onClearHighlight?: () => void
}) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<{
    item: RoleApplicationItem
    decision: 'approve' | 'reject'
  } | null>(null)
  const [note, setNote] = useState('')
  const qc = useQueryClient()
  const focused = Boolean(highlightApplicationId)

  // 通知深链按 id 定向取一条，避免目标排在 100 条之后时整页找不到。
  const query = useQuery<AdminRoleApplications>({
    queryKey: ['admin', 'role-applications', 'list', filter, page, highlightApplicationId ?? 0],
    queryFn: async () =>
      (
        await api.get('/gamification/admin/applications', {
          params: {
            ...(focused
              ? { application_id: highlightApplicationId, page: 1, page_size: 1 }
              : { page, page_size: PAGE_SIZE }),
            ...(filter === 'all' || focused ? {} : { status: filter }),
          },
        })
      ).data,
  })

  const pendingQuery = useQuery<AdminRoleApplications>({
    queryKey: ['admin', 'role-applications', 'pending-count'],
    queryFn: async () =>
      (
        await api.get('/gamification/admin/applications', {
          params: { status: 'pending', page: 1, page_size: 1 },
        })
      ).data,
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
    },
    onError: (err) => toast.error(extractError(err, '没能处理这份角色申请，可再试一次')),
  })

  const items = query.data?.data ?? []
  const disciplines = useDisciplines()
  const disciplineNames = new Map((disciplines.data ?? []).map((item) => [item.slug, item.name]))
  const meta = query.data?.meta
  const pendingCount = pendingQuery.data?.meta.total ?? 0
  const totalPages = meta?.total_pages ?? 1
  const missingFocused = focused && !query.isLoading && !query.isError && items.length === 0

  useEffect(() => {
    if (focused || query.isLoading || !meta) return
    if (meta.total_pages > 0 && page > meta.total_pages) setPage(meta.total_pages)
  }, [focused, meta, page, query.isLoading])

  useEffect(() => {
    if (!focused || !highlightApplicationId || items.length === 0) return
    const timer = window.setTimeout(() => {
      document.getElementById(`role-application-admin-${highlightApplicationId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [focused, highlightApplicationId, items.length])

  return (
    <div>
      <PageHeader
        title="角色申请"
        description="互评成员和资深互评成员由这里处理；通过后身份立即生效，对方会收到通知。"
      />

      {focused ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <span>正在查看通知指到的那份申请（#{highlightApplicationId}）。</span>
          <Button
            size="sm"
            variant="link"
            className="h-auto px-0"
            onClick={() => onClearHighlight?.()}
          >
            查看全部申请
          </Button>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((key) => (
            <Button
              key={key}
              size="sm"
              variant={filter === key ? 'default' : 'outline'}
              onClick={() => {
                setFilter(key)
                setPage(1)
              }}
            >
              {STATUS_LABELS[key]}
              {key === 'pending' && pendingCount > 0 ? (
                <span className="ml-1 rounded-full bg-background/20 px-1.5 font-mono text-[10px]">
                  {pendingCount}
                </span>
              ) : null}
            </Button>
          ))}
        </div>
      )}

      {query.isLoading ? (
        <LoadingSkeleton rows={3} />
      ) : query.isError ? (
        <ErrorState message="角色申请加载失败，可重试。" onRetry={() => void query.refetch()} />
      ) : missingFocused ? (
        <EmptyState
          title="没有找到这份角色申请"
          description="它可能已被删除，或者通知里的编号已经失效。"
          action={
            <Button size="sm" variant="outline" onClick={() => onClearHighlight?.()}>
              查看全部申请
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={filter === 'pending' ? '没有待处理的角色申请' : '暂无记录'}
          description="作者达到门槛后可自行提交申请；通过后身份立即生效。"
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card
              id={`role-application-admin-${item.id}`}
              key={item.id}
              className={cn(
                'transition-shadow',
                item.status === 'pending'
                  ? 'border-l-4 border-l-amber-500'
                  : item.status === 'approved'
                    ? 'border-l-4 border-l-emerald-500'
                    : 'border-l-4 border-l-destructive',
                focused && highlightApplicationId === item.id && 'ring-2 ring-primary/60 ring-offset-2',
              )}
            >
              <CardContent className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  {statusBadge(item.status)}
                  <Badge variant="outline">{ROLE_LABELS[item.target_role] ?? item.target_role}</Badge>
                  {item.username ? (
                    <Link
                      to="/u/$username"
                      params={{ username: item.username }}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-sm font-medium hover:text-primary hover:underline"
                      title="打开申请人公开主页"
                    >
                      {item.username}
                      <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
                    </Link>
                  ) : (
                    <span className="text-sm font-medium">用户 #{item.user_id}</span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">{dateText(item.created_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.statement}</p>
                {(item.subject_disciplines ?? []).length > 0 ||
                (item.reviewer_disciplines ?? []).length > 0 ||
                (item.reviewer_tags ?? []).length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    {(item.subject_disciplines ?? []).length > 0 ? (
                      <>
                        <span className="text-muted-foreground">科目</span>
                        {(item.subject_disciplines ?? []).map((slug) => (
                          <Badge key={slug} variant="secondary" className="text-[10px] font-normal">
                            {disciplineNames.get(slug) ?? slug}
                          </Badge>
                        ))}
                      </>
                    ) : null}
                    {(item.reviewer_disciplines ?? []).length > 0 ? (
                      <>
                        <span className="ml-1 text-muted-foreground">审稿</span>
                        {(item.reviewer_disciplines ?? []).map((slug) => (
                          <Badge key={slug} variant="outline" className="text-[10px] font-normal">
                            {disciplineNames.get(slug) ?? slug}
                          </Badge>
                        ))}
                      </>
                    ) : null}
                    {(item.reviewer_tags ?? []).length > 0 ? (
                      <>
                        <span className="ml-1 text-muted-foreground">能力</span>
                        {(item.reviewer_tags ?? []).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px] font-normal">
                            {tag}
                          </Badge>
                        ))}
                      </>
                    ) : null}
                  </div>
                ) : item.status === 'pending' ? (
                  <p className="mt-2 text-[11px] text-amber-700">
                    申请人还没填科目与审稿领域；可先在成员管理里补，再决定。
                  </p>
                ) : null}
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

      {!focused && meta && totalPages > 1 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>
            共 {meta.total} 条，第 {meta.page} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            >
              下一页
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

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
