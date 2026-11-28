import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Clock3,
  History,
  Loader2,
  Undo2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'
import { extractError } from '@/lib/utils'
import { plainTextPreview } from '@/lib/text-preview'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MODERATION_STATUS_LABEL, MODERATION_STATUS_TONE } from '@/lib/forum-copy'
import { cn } from '@/lib/utils'

interface Signal {
  code: string
  label: string
  detail: string
  weight: number
}

interface QueueItem {
  id: number
  title: string
  body: string
  board_name: string | null
  board_path: string | null
  author: { id: number; username: string; display_name?: string | null } | null
  moderation_status: string
  risk_score: number
  moderation_signals: Signal[]
  manual_review_reason: string | null
  review_eta_at: string | null
  created_at: string
  reviewed_at: string | null
  reviewed_by: { id: number; username: string; display_name?: string | null } | null
}

interface QueuePage {
  data: QueueItem[]
  meta: { total: number; page: number; page_size: number; total_pages: number }
}

interface ModerationSettings {
  auto_publish_enabled: boolean
  manual_threshold: number
  sla_minutes: number
  weights: Record<string, number>
  priority_risk_weight: number
  priority_age_weight: number
  gray_rules: Record<string, unknown>
  updated_at?: string | null
}

interface EventRow {
  id: number
  action: string
  from_status: string | null
  to_status: string | null
  note: string | null
  created_at: string
  actor: { username: string; display_name?: string | null } | null
}

interface PreflightItem {
  id: number
  title: string
  status: string
  target_status: string
  will_change: boolean
  risk_score: number
}

interface PreflightResult {
  count: number
  action: DecisionAction
  will_change_count: number
  unchanged_count: number
  items: PreflightItem[]
}

interface BatchRecord {
  batchId: string
  count: number
}

type StatusFilter = 'manual_review' | 'changes_requested' | 'rejected' | 'all'
type SortMode = 'priority' | 'oldest' | 'newest'
type DecisionAction = 'approve' | 'reject' | 'changes'

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'manual_review', label: '待人工核验' },
  { key: 'changes_requested', label: '待作者修改' },
  { key: 'rejected', label: '未通过' },
  { key: 'all', label: '全部处置' },
]

const ACTION_COPY: Record<DecisionAction, { title: string; button: string; hint: string }> = {
  approve: {
    title: '通过核验并公开',
    button: '确认通过',
    hint: '通过后会立刻进入公开列表，作者会收到站内通知。批量通过只用于内容已确认无风险的主题帖。',
  },
  changes: {
    title: '要求作者调整',
    button: '发出调整要求',
    hint: '主题帖会从前台撤下，作者可在原帖上修改；说明会同时写入站内通知。',
  },
  reject: {
    title: '不通过核验',
    button: '确认不通过',
    hint: '主题帖会保持隐藏；作者仍能看到处理说明并修改后重新提交。',
  },
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function etaText(iso: string | null): string {
  if (!iso) return '未设时限'
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  if (minutes <= 0) return '已到预计时限'
  return `剩余 ${minutes} 分钟`
}

function statusBadge(status: string) {
  return (
    <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', MODERATION_STATUS_TONE[status])}>
      {MODERATION_STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

export default function ForumModerationPage({ highlightTopicId }: { highlightTopicId?: number }) {
  const qc = useQueryClient()
  const { user, isAdmin } = useAuth()
  const canManageRules =
    isAdmin ||
    (user?.roles ?? []).some((role) => ['editor_in_chief', 'chief_editor', 'deputy_editor'].includes(role))
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('manual_review')
  const [sort, setSort] = useState<SortMode>('priority')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number[]>([])
  const [actionDialog, setActionDialog] = useState<{ action: DecisionAction; ids: number[] } | null>(null)
  const [note, setNote] = useState('')
  const [historyId, setHistoryId] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [preflight, setPreflight] = useState<
    { ids: number[]; action: DecisionAction; result: PreflightResult } | null
  >(null)
  const [lastBatch, setLastBatch] = useState<BatchRecord | null>(null)
  const [feedbackTarget, setFeedbackTarget] = useState<QueueItem | null>(null)
  const [feedbackVerdict, setFeedbackVerdict] = useState<'false_positive' | 'correct'>('false_positive')
  const [feedbackNote, setFeedbackNote] = useState('')

  const insightsQ = useQuery({
    queryKey: ['admin', 'forum-moderation', 'insights'],
    queryFn: async () =>
      (
        await api.get<{
          days: number
          decisions: Record<string, number>
          feedback: Record<string, number>
          false_positive_rate: number
          signals: Array<{
            code: string
            hits: number
            false_positive: number
            false_positive_rate: number
          }>
        }>('/forum/moderation/insights', { params: { days: 30 } })
      ).data,
  })

  const statsQ = useQuery({
    queryKey: ['admin', 'forum-moderation', 'stats'],
    queryFn: async () => (await api.get<Record<string, number>>('/forum/moderation/stats')).data,
  })

  const effectiveStatus: StatusFilter = highlightTopicId ? 'all' : statusFilter
  const queueQ = useQuery({
    queryKey: ['admin', 'forum-moderation', effectiveStatus, sort, page, highlightTopicId],
    queryFn: async () =>
      (
        await api.get<QueuePage>('/forum/moderation/queue', {
          params: {
            status: effectiveStatus,
            sort,
            page,
            page_size: 20,
            ...(highlightTopicId ? { topic_id: highlightTopicId } : {}),
          },
        })
      ).data,
  })

  const settingsQ = useQuery({
    queryKey: ['admin', 'forum-moderation', 'settings'],
    queryFn: async () => (await api.get<ModerationSettings>('/forum/moderation/settings')).data,
  })

  const historyQ = useQuery({
    queryKey: ['admin', 'forum-moderation', 'events', historyId],
    enabled: historyId !== null,
    queryFn: async () => (await api.get<EventRow[]>(`/forum/moderation/topics/${historyId}/events`)).data,
  })

  const decisionMut = useMutation({
    mutationFn: async ({ action, ids, note: decisionNote }: { action: DecisionAction; ids: number[]; note: string }) => {
      if (ids.length === 1) {
        return (await api.post(`/forum/moderation/topics/${ids[0]}/decision`, { action, note: decisionNote })).data
      }
      return (await api.post<{ count: number; batch_id: string }>('/forum/moderation/batch', {
        topic_ids: ids,
        action,
        note: decisionNote,
      })).data
    },
    onSuccess: (data, variables) => {
      toast.success(actionDialog?.action === 'approve' ? '已通过核验并公开' : '已记录处理结果')
      if (variables.ids.length > 1 && 'batch_id' in data) {
        setLastBatch({ batchId: data.batch_id, count: data.count })
      }
      setActionDialog(null)
      setNote('')
      setPreflight(null)
      setSelected([])
      void qc.invalidateQueries({ queryKey: ['admin', 'forum-moderation'] })
      void qc.invalidateQueries({ queryKey: ['forum'] })
    },
    onError: (err) => toast.error(extractError(err, '处理失败，可稍后重试')),
  })

  const preflightMut = useMutation({
    mutationFn: async (input: { ids: number[]; action: DecisionAction; note: string }) =>
      (
        await api.post<PreflightResult>('/forum/moderation/batch/preflight', {
          topic_ids: input.ids,
          action: input.action,
          note: input.note,
        })
      ).data,
    onSuccess: (result, variables) => {
      setPreflight({ ids: variables.ids, action: variables.action, result })
    },
    onError: (err) => toast.error(extractError(err, '预检失败')),
  })

  const feedbackMut = useMutation({
    mutationFn: async (input: {
      topicId: number
      verdict: 'false_positive' | 'correct'
      note: string
      signalCode?: string | null
    }) =>
      (
        await api.post(`/forum/moderation/topics/${input.topicId}/feedback`, {
          verdict: input.verdict,
          note: input.note,
          ...(input.signalCode ? { signal_code: input.signalCode } : {}),
        })
      ).data,
    onSuccess: () => {
      toast.success('误判反馈已记录，会进入规则命中率统计')
      setFeedbackTarget(null)
      setFeedbackNote('')
      void qc.invalidateQueries({ queryKey: ['admin', 'forum-moderation', 'insights'] })
    },
    onError: (err) => toast.error(extractError(err, '反馈记录失败')),
  })

  const undoMut = useMutation({
    mutationFn: async (batchId: string) =>
      (await api.post<{ restored: number }>(`/forum/moderation/batch/${batchId}/undo`)).data,
    onSuccess: (data) => {
      toast.success(data.restored > 0 ? `已撤销 ${data.restored} 条处置` : '可撤销窗口内没有可恢复的条目')
      setLastBatch(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'forum-moderation'] })
      void qc.invalidateQueries({ queryKey: ['forum'] })
    },
    onError: (err) => toast.error(extractError(err, '撤销失败')),
  })

  const settingsMut = useMutation({
    mutationFn: async (payload: ModerationSettings) =>
      (await api.put<ModerationSettings>('/forum/moderation/settings', payload)).data,
    onSuccess: () => {
      toast.success('规则设置已保存，新主题帖立即按新阈值执行')
      setSettingsOpen(false)
      void qc.invalidateQueries({ queryKey: ['admin', 'forum-moderation', 'settings'] })
    },
    onError: (err) => toast.error(extractError(err, '规则设置保存失败')),
  })

  const stats = statsQ.data
  const rows = queueQ.data?.data ?? []
  const meta = queueQ.data?.meta
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const allSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row.id))

  const toggleOne = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]))
  }

  const toggleAll = () => {
    setSelected(allSelected ? [] : rows.map((row) => row.id))
  }

  const openAction = (action: DecisionAction, ids: number[]) => {
    if (ids.length === 0) return
    setNote('')
    setPreflight(null)
    setActionDialog({ action, ids })
  }

  const preflightReady =
    actionDialog !== null &&
    preflight !== null &&
    preflight.action === actionDialog.action &&
    preflight.ids.length === actionDialog.ids.length &&
    preflight.ids.every((id, index) => id === actionDialog.ids[index])

  return (
    <div>
      <PageHeader
        title="内容核验队列"
        description="规则引擎先做确定性初筛，命中边界或高风险信号的主题帖进入这里。所有处置都会写审计事件，并通知作者。"
        actions={
          canManageRules ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              规则设置
            </Button>
          ) : null
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        {[
          { label: '待人工核验', value: stats?.manual_review ?? '—', Icon: AlertTriangle },
          { label: '待作者修改', value: stats?.changes_requested ?? '—', Icon: Clock3 },
          { label: '已公开', value: stats?.published ?? '—', Icon: ShieldCheck },
          { label: '未通过', value: stats?.rejected ?? '—', Icon: X },
        ].map(({ label, value, Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
              </div>
              <Icon className="h-5 w-5 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      {insightsQ.data ? (
        <Card className="mb-3">
          <CardContent className="p-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-medium">近 30 天规则命中</span>
              <span className="text-muted-foreground">
                通过 {insightsQ.data.decisions.approve ?? 0} · 要求修改{' '}
                {insightsQ.data.decisions.changes ?? 0} · 不通过{' '}
                {insightsQ.data.decisions.reject ?? 0}
              </span>
              <span className={insightsQ.data.false_positive_rate >= 15 ? 'font-medium text-amber-700' : ''}>
                误判率 {insightsQ.data.false_positive_rate}%
              </span>
            </div>
            {insightsQ.data.signals.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {insightsQ.data.signals.slice(0, 6).map((signal) => (
                  <Badge key={signal.code} variant="outline" className="text-[10px]">
                    {signal.code} · 命中 {signal.hits} · 误判 {signal.false_positive}（
                    {signal.false_positive_rate}%）
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {highlightTopicId ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
          <span>正在定位主题帖 #{highlightTopicId} 的核验记录；处置完成后可继续浏览全部队列。</span>
          <Button size="sm" variant="ghost" onClick={() => window.location.assign('/admin/content?section=moderation')}>
            查看全部队列
          </Button>
        </div>
      ) : null}

      {lastBatch ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
          <span>
            刚才批量处理了 {lastBatch.count} 条 · 批次 {lastBatch.batchId} · 10 分钟内可补偿撤销
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={undoMut.isPending}
              onClick={() => undoMut.mutate(lastBatch.batchId)}
            >
              {undoMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              撤销这批
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLastBatch(null)}>
              收起
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.key}
            size="sm"
            variant={statusFilter === tab.key ? 'default' : 'outline'}
            onClick={() => {
              setStatusFilter(tab.key)
              setPage(1)
              setSelected([])
            }}
          >
            {tab.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-1 rounded-lg border p-0.5">
          {([
            ['priority', '风险优先'],
            ['oldest', '等待最久'],
            ['newest', '最新提交'],
          ] as const).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={sort === key ? 'secondary' : 'ghost'}
              className="h-7 px-2 text-xs"
              onClick={() => setSort(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {queueQ.isLoading ? (
        <Loading />
      ) : queueQ.isError ? (
        <ErrorState message="核验队列加载失败，可重试。" onRetry={() => queueQ.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="当前队列已清空"
          description="新的边界内容进入后会出现在这里；规则阈值可在右上角调整。"
        />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-3.5 w-3.5 accent-primary" />
              全选本页
            </label>
            <div className="flex items-center gap-2">
              <span>已选 {selected.length} 条</span>
              <Button size="sm" variant="outline" disabled={selected.length === 0} onClick={() => openAction('approve', selected)}>
                <Check className="h-3.5 w-3.5" />
                批量通过
              </Button>
              <Button size="sm" variant="outline" disabled={selected.length === 0} onClick={() => openAction('changes', selected)}>
                批量要求修改
              </Button>
              <Button size="sm" variant="outline" disabled={selected.length === 0} onClick={() => openAction('reject', selected)}>
                批量不通过
              </Button>
            </div>
          </div>

          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                    aria-label={`选择主题帖 ${row.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {statusBadge(row.moderation_status)}
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        风险 {row.risk_score}
                      </Badge>
                      <a href={`/forum/${row.id}`} target="_blank" rel="noreferrer" className="truncate text-sm font-medium hover:underline">
                        {row.title}
                      </a>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {plainTextPreview(row.body, 180)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{row.board_path || row.board_name || '未分区'}</span>
                      <span>作者：{row.author?.display_name || row.author?.username || '已注销'}</span>
                      <span>提交 {fmtTime(row.created_at)}</span>
                      <span className={cn(row.review_eta_at && new Date(row.review_eta_at).getTime() < Date.now() && 'text-destructive')}>
                        {etaText(row.review_eta_at)}
                      </span>
                    </div>
                    {(row.moderation_signals.length > 0 || row.manual_review_reason) && (
                      <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
                        {row.manual_review_reason ? <p>{row.manual_review_reason}</p> : null}
                        {row.moderation_signals.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {row.moderation_signals.map((signal) => (
                              <Badge key={signal.code} variant="outline" className="h-5 px-1.5 text-[10px]">
                                {signal.label} +{signal.weight}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                  <div className="flex w-32 shrink-0 flex-col gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setHistoryId(row.id)}>
                      <History className="h-3.5 w-3.5" />
                      处理记录
                    </Button>
                    <Button size="sm" onClick={() => openAction('approve', [row.id])}>
                      <Check className="h-3.5 w-3.5" />
                      通过
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openAction('changes', [row.id])}>
                      要求修改
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => openAction('reject', [row.id])}>
                      不通过
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1 text-[11px] text-muted-foreground"
                      onClick={() => {
                        setFeedbackVerdict('false_positive')
                        setFeedbackNote('')
                        setFeedbackTarget(row)
                      }}
                    >
                      误判反馈
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {meta && meta.total_pages > 1 ? (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            第 {meta.page} / {meta.total_pages} 页 · 共 {meta.total} 条
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              上一页
            </Button>
            <Button size="sm" variant="outline" disabled={page >= meta.total_pages} onClick={() => setPage((value) => value + 1)}>
              下一页
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={actionDialog !== null} onOpenChange={(open) => { if (!open) setActionDialog(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{actionDialog ? ACTION_COPY[actionDialog.action].title : '处置主题帖'}</DialogTitle>
          </DialogHeader>
          {actionDialog ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {ACTION_COPY[actionDialog.action].hint}
                {actionDialog.ids.length > 1 ? ` 本次将处理 ${actionDialog.ids.length} 条。` : ''}
              </p>
              {actionDialog.ids.length > 1 ? (
                <div className="rounded-lg border bg-muted/20 p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">批量预检</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        preflightMut.isPending ||
                        (actionDialog.action !== 'approve' && note.trim().length < 4)
                      }
                      onClick={() =>
                        preflightMut.mutate({
                          ids: actionDialog.ids,
                          action: actionDialog.action,
                          note: note.trim(),
                        })
                      }
                    >
                      {preflightMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {preflightReady ? '重新预检' : `预检这 ${actionDialog.ids.length} 条`}
                    </Button>
                  </div>
                  {preflightReady && preflight ? (
                    <div className="mt-2 space-y-1">
                      <p>
                        将改变 <strong>{preflight.result.will_change_count}</strong> 条；已是目标状态、不会再变{' '}
                        <strong>{preflight.result.unchanged_count}</strong> 条。
                      </p>
                      <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                        {preflight.result.items.slice(0, 20).map((item) => (
                          <li key={item.id} className="flex items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={item.will_change ? 'border-sky-400' : 'border-muted text-muted-foreground'}
                            >
                              {item.will_change ? '将处理' : '跳过'}
                            </Badge>
                            <span className="truncate">
                              #{item.id} {item.title}
                            </span>
                            <span className="ml-auto shrink-0 text-muted-foreground">
                              {MODERATION_STATUS_LABEL[item.status] ?? item.status} →{' '}
                              {MODERATION_STATUS_LABEL[item.target_status] ?? item.target_status}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {preflight.result.items.length > 20 ? (
                        <p className="text-muted-foreground">
                          另有 {preflight.result.items.length - 20} 条未展开。
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-muted-foreground">
                      先预检，确认这批会影响哪些帖子；预检不写任何处置，也不会通知作者。
                    </p>
                  )}
                </div>
              ) : null}
              <div>
                <Label htmlFor="moderation-note">
                  处理说明{actionDialog.action === 'approve' ? '（可选）' : '（至少 4 个字）'}
                </Label>
                <Textarea
                  id="moderation-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  placeholder="写清楚原因或需要作者调整的地方，作者会在站内通知里看到。"
                  className="mt-1.5"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setActionDialog(null)}>取消</Button>
                <Button
                  disabled={
                    decisionMut.isPending ||
                    (actionDialog.action !== 'approve' && note.trim().length < 4) ||
                    (actionDialog.ids.length > 1 && !preflightReady)
                  }
                  onClick={() => decisionMut.mutate({ action: actionDialog.action, ids: actionDialog.ids, note: note.trim() })}
                >
                  {decisionMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {ACTION_COPY[actionDialog.action].button}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={feedbackTarget !== null} onOpenChange={(open) => { if (!open) setFeedbackTarget(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>审核误判反馈</DialogTitle>
          </DialogHeader>
          {feedbackTarget ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                #{feedbackTarget.id} {feedbackTarget.title}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={feedbackVerdict === 'false_positive' ? 'default' : 'outline'}
                  onClick={() => setFeedbackVerdict('false_positive')}
                >
                  规则误报
                </Button>
                <Button
                  size="sm"
                  variant={feedbackVerdict === 'correct' ? 'default' : 'outline'}
                  onClick={() => setFeedbackVerdict('correct')}
                >
                  命中正确
                </Button>
              </div>
              <div className="space-y-1">
                <Label htmlFor="feedback-note">说明（可选）</Label>
                <Textarea
                  id="feedback-note"
                  rows={3}
                  value={feedbackNote}
                  onChange={(e) => setFeedbackNote(e.target.value.slice(0, 1000))}
                  placeholder="例如：只是正常讨论方法，不含攻击；误判原因是“对立表述”。"
                />
              </div>
              <div className="flex justify-end gap-2 border-t pt-3">
                <Button variant="outline" onClick={() => setFeedbackTarget(null)}>
                  取消
                </Button>
                <Button
                  disabled={feedbackMut.isPending}
                  onClick={() =>
                    feedbackMut.mutate({
                      topicId: feedbackTarget.id,
                      verdict: feedbackVerdict,
                      note: feedbackNote.trim(),
                      signalCode: feedbackTarget.moderation_signals[0]?.code,
                    })
                  }
                >
                  {feedbackMut.isPending ? '记录中…' : '记录反馈'}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={historyId !== null} onOpenChange={(open) => { if (!open) setHistoryId(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>人工处理记录 #{historyId}</DialogTitle>
          </DialogHeader>
          {historyQ.isLoading ? <Loading /> : historyQ.isError ? (
            <ErrorState message="处理记录加载失败" onRetry={() => historyQ.refetch()} />
          ) : (
            <div className="max-h-[60dvh] space-y-3 overflow-y-auto">
              {(historyQ.data ?? []).map((event) => (
                <div key={event.id} className="rounded-lg border px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{event.action}</Badge>
                    <span className="text-muted-foreground">
                      {event.from_status || '—'} → {event.to_status || '—'}
                    </span>
                    <span className="ml-auto text-muted-foreground">{fmtTime(event.created_at)}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{event.note || '无说明'}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">操作人：{event.actor?.display_name || event.actor?.username || '系统/规则'}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>半自动化规则设置</DialogTitle>
          </DialogHeader>
          {settingsQ.isLoading || !settingsQ.data ? <Loading /> : (
            <SettingsForm
              initial={settingsQ.data}
              pending={settingsMut.isPending}
              onSave={(payload) => settingsMut.mutate(payload)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SettingsForm({
  initial,
  pending,
  onSave,
}: {
  initial: ModerationSettings
  pending: boolean
  onSave: (payload: ModerationSettings) => void
}) {
  const [form, setForm] = useState<ModerationSettings>(initial)
  const [grayText, setGrayText] = useState(
    JSON.stringify(initial.gray_rules ?? {}, null, 2),
  )
  const [grayError, setGrayError] = useState('')

  const save = () => {
    let gray: Record<string, unknown> = {}
    if (grayText.trim()) {
      try {
        const parsed = JSON.parse(grayText)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setGrayError('灰度规则必须是 JSON 对象。')
          return
        }
        gray = parsed as Record<string, unknown>
      } catch {
        setGrayError('灰度规则不是合法 JSON，先改好再保存。')
        return
      }
    }
    setGrayError('')
    onSave({ ...form, gray_rules: gray })
  }
  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
        <input
          type="checkbox"
          checked={form.auto_publish_enabled}
          onChange={(event) => setForm((prev) => ({ ...prev, auto_publish_enabled: event.target.checked }))}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span>
          <span className="font-medium">启用自动发布</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            关闭后所有新主题帖都进入人工核验；已公开内容不受影响，适合活动期或风险期临时收紧。
          </span>
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="manual-threshold">进入人工核验的风险分阈值</Label>
          <Input
            id="manual-threshold"
            type="number"
            min={1}
            max={99}
            value={form.manual_threshold}
            onChange={(event) => setForm((prev) => ({ ...prev, manual_threshold: Number(event.target.value) }))}
            className="mt-1.5"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">默认 40。1–99，越低越严格。</p>
        </div>
        <div>
          <Label htmlFor="sla-minutes">人工核验预计时限（分钟）</Label>
          <Input
            id="sla-minutes"
            type="number"
            min={1}
            max={1440}
            value={form.sla_minutes}
            onChange={(event) => setForm((prev) => ({ ...prev, sla_minutes: Number(event.target.value) }))}
            className="mt-1.5"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">默认 30。前台会向作者展示这个预计时限。</p>
        </div>
        <div>
          <Label htmlFor="priority-risk-weight">队列排序：风险权重</Label>
          <Input
            id="priority-risk-weight"
            type="number"
            min={0}
            max={100}
            value={form.priority_risk_weight}
            onChange={(event) => setForm((prev) => ({ ...prev, priority_risk_weight: Number(event.target.value) }))}
            className="mt-1.5"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">风险分 × 此权重。0 表示排序不看风险。</p>
        </div>
        <div>
          <Label htmlFor="priority-age-weight">队列排序：等待权重</Label>
          <Input
            id="priority-age-weight"
            type="number"
            min={0}
            max={100}
            value={form.priority_age_weight}
            onChange={(event) => setForm((prev) => ({ ...prev, priority_age_weight: Number(event.target.value) }))}
            className="mt-1.5"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">每小时等待 × 此权重；长尾积压会随等待时间上来。</p>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium">风险信号权重</p>
        <p className="mt-1 text-[11px] text-muted-foreground">设为 0 可关闭单项信号；硬命中（广告/辱骂）不受此表影响。</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {[
            ['contact', '疑似联系方式'],
            ['external_link', '站外链接'],
            ['low_effort', '信息量偏低'],
            ['shouting', '格式异常'],
          ].map(([code, label]) => (
            <label key={code} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs">
              <span>{label}</span>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.weights?.[code] ?? 0}
                onChange={(event) => setForm((prev) => ({
                  ...prev,
                  weights: { ...(prev.weights ?? {}), [code]: Number(event.target.value) },
                }))}
                className="h-8 w-16 text-center"
              />
            </label>
          ))}
        </div>
      </div>
      <div>
        <Label htmlFor="gray-rules">灰度规则（按分区或角色收紧阈值）</Label>
        <Textarea
          id="gray-rules"
          value={grayText}
          onChange={(event) => setGrayText(event.target.value)}
          rows={5}
          className="mt-1.5 font-mono text-xs"
          placeholder={'{\n  "boards": {"site": {"manual_threshold": 20}},\n  "roles": {"user": {"manual_threshold": 30}}\n}'}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          分区规则优先于角色规则；留空或用 {'{}'} 表示全站统一阈值。只接受 manual_threshold、auto_publish_enabled 和 weights。
        </p>
        {grayError ? <p className="mt-1 text-[11px] text-destructive">{grayError}</p> : null}
      </div>
      <div className="flex justify-end">
        <Button disabled={pending} onClick={save}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          保存规则
        </Button>
      </div>
    </div>
  )
}
