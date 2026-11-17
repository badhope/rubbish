import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Gavel,
  History,
  MailWarning,
  Search,
  Send,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { getAuthState } from '@/lib/auth'
import {
  useBatchAssign,
  useCancelAssignment,
  useCheckConflicts,
  useEditorDecision,
  useEditorEmailDigestRecords,
  useEditorWorkbench,
  useDisciplines,
  useRemindReviewers,
  useReviewerCandidates,
  useReviewerWorkload,
  useEditorReportSearch,
  useSubmissionReports,
  useSubmissionTimeline,
  useSubmission,
  useSubmissionDownloadTicket,
  useSubmissionMarkdown,
  useWaiveReview,
  type ConflictCandidate,
} from '@/hooks/api/use-modules'
import { REVIEW_DIMENSION_LABELS, reviewDimensionEntries } from '@/lib/review-dimensions'
import { extractError } from '@/lib/utils'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { MarkdownContent } from '@/components/common/markdown-content'
import { PageHeader } from '@/components/common/page-header'
import { HelpTip } from '@/components/common/help-tip'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const Route = createFileRoute('/editor/workbench')({
  beforeLoad: () => {
    const state = getAuthState()
    if (!state.isAuthenticated) throw redirect({ to: '/login' })
    const roles = state.user?.roles ?? []
    if (!state.isAdmin && !roles.some((r) => ['editor', 'section_editor', 'editor_in_chief'].includes(r))) {
      throw redirect({ to: '/403' })
    }
  },
  component: EditorWorkbenchPage,
})

type ColumnKey = 'to_assign' | 'in_review' | 'rework' | 'to_decide' | 'decided'

const COLUMN_META: { key: ColumnKey; title: string; accent: string }[] = [
  { key: 'to_assign', title: '待指派', accent: 'bg-slate-100 text-slate-700 dark:bg-slate-800' },
  { key: 'in_review', title: '评审中', accent: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40' },
  { key: 'rework', title: '返修中', accent: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40' },
  { key: 'to_decide', title: '待裁决', accent: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40' },
  { key: 'decided', title: '已决定', accent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40' },
]

function EditorWorkbenchPage() {
  const { data, isLoading, isError, refetch } = useEditorWorkbench()
  const candidates = useReviewerCandidates(200)
  const disciplines = useDisciplines()
  const disciplineNames = new Map(
    (disciplines.data ?? []).map((item) => [item.slug, item.name]),
  )
  const workload = useReviewerWorkload()
  const batchMut = useBatchAssign()
  const cancelAssignMut = useCancelAssignment()
  const conflictsMut = useCheckConflicts()
  const remindMut = useRemindReviewers()
  const decisionMut = useEditorDecision()
  const waiveMut = useWaiveReview()

  // 待指派勾选
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [assignOpen, setAssignOpen] = useState(false)
  const [selectedReviewers, setSelectedReviewers] = useState<number[]>([])
  const [dueDays, setDueDays] = useState(14)
  const [conflicts, setConflicts] = useState<Record<number, ConflictCandidate>>({})
  const [onlySameDiscipline, setOnlySameDiscipline] = useState(false)

  // 待裁决：当前正在裁决的稿件 id
  const [decidingId, setDecidingId] = useState<number | null>(null)
  // 查看稿件（裁决前必须能读正文，而不是只看标题）
  const [viewingId, setViewingId] = useState<number | null>(null)
  const [decision, setDecision] = useState<'accept' | 'minor_revision' | 'major_revision' | 'reject'>('major_revision')
  const [editorNote, setEditorNote] = useState('')
  // 免评审录用：只在选择「录用」时出现；理由会随 waive-review 写审计。
  const [waiveReview, setWaiveReview] = useState(false)
  const [waiveReason, setWaiveReason] = useState('')

  // 邮件摘要状态条：展开查看投递记录
  const [digestOpen, setDigestOpen] = useState(false)
  // 主编全文检索审稿意见
  const [reportsOpen, setReportsOpen] = useState(false)
  const [reportsQuery, setReportsQuery] = useState('')
  // 更换审稿人：先撤回在途邀请，再打开指派弹窗选新人。
  const [replaceTarget, setReplaceTarget] = useState<{
    submissionId: number
    assignmentIds: number[]
    names: string
  } | null>(null)

  const columns = data?.columns
  const digest = data?.email_digest

  // 单稿指派时提供与初筛台一致的「只看自选学科」筛选；多稿学科不一，不提供。
  const checkedDiscipline =
    checked.size === 1
      ? (Object.values(columns ?? {})
          .flatMap((col) => col.items)
          .find((item) => checked.has(item.submission_id))?.discipline ?? null)
      : null
  const checkedDisciplineSlug = checkedDiscipline
    ? (disciplines.data ?? []).find((d) => d.name === checkedDiscipline)?.slug
    : undefined
  const allCandidates = candidates.data ?? []
  const dialogCandidates =
    onlySameDiscipline && checkedDisciplineSlug
      ? allCandidates.filter((c) => (c.reviewer_disciplines ?? []).includes(checkedDisciplineSlug))
      : allCandidates

  // 只有在琥珀/红两态下才按需拉 records；绿色态不需要
  const digestRecords = useEditorEmailDigestRecords({
    enabled: digestOpen && !!digest && (!digest.smtp_configured || digest.last_status === 'failed'),
  })

  // 状态条配色与文案：必须诚实，绝不能让主编以为邮件真发了
  type DigestTone = 'idle' | 'amber' | 'red' | 'green'
  let digestTone: DigestTone = 'idle'
  if (digest) {
    if (!digest.smtp_configured) digestTone = 'amber'
    else if (digest.last_status === 'failed') digestTone = 'red'
    else if (digest.last_status === 'sent') digestTone = 'green'
    else digestTone = 'idle' // 配了 SMTP 但还没发过任何记录
  }

  const toggleCheck = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openAssignDialog = async (ids?: number[]) => {
    const selectedIds = ids ?? [...checked]
    if (selectedIds.length === 0) {
      toast.info('请先勾选至少一篇待指派稿件')
      return
    }
    setChecked(new Set(selectedIds))
    setAssignOpen(true)
    setSelectedReviewers([])
    setOnlySameDiscipline(false)
    setConflicts({})
    // 对第一篇勾选稿件跑一次冲突检查（多稿件时共用候选名单；冲突提示以该稿件为准）
    const firstSubId = selectedIds[0]
    if (candidates.data && candidates.data.length) {
      try {
        const res = await conflictsMut.mutateAsync({
          submission_id: firstSubId,
          reviewer_ids: candidates.data.map((c) => c.id),
        })
        const map: Record<number, ConflictCandidate> = {}
        for (const c of res.candidates) map[c.reviewer_id] = c
        setConflicts(map)
      } catch (err) {
        // 冲突接口失败不阻塞指派，仅静默降级
        console.warn('conflicts check failed', err)
      }
    }
  }

  const onConfirmReplace = async () => {
    if (!replaceTarget) return
    const target = replaceTarget
    setReplaceTarget(null)
    try {
      for (const assignmentId of target.assignmentIds) {
        await cancelAssignMut.mutateAsync({
          submissionId: target.submissionId,
          assignmentId,
        })
      }
      toast.success('已撤回旧邀请，请选择新的审稿人')
      await openAssignDialog([target.submissionId])
    } catch (err) {
      toast.error(extractError(err, '更换审稿人失败'))
    }
  }

  const onToggleReviewer = (id: number) => {
    setSelectedReviewers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const onBatchAssign = async () => {
    if (selectedReviewers.length === 0) {
      toast.info('请至少选择一位审稿人')
      return
    }
    try {
      const res = await batchMut.mutateAsync({
        items: [...checked].map((submission_id) => ({
          submission_id,
          reviewer_ids: selectedReviewers,
        })),
        due_days: dueDays,
      })
      toast.success(`已指派 ${res.created_count} 条审稿任务`)
      if (res.skipped.length > 0) {
        toast.warning(`跳过 ${res.skipped.length} 条（自审/状态不符）`)
      }
      setAssignOpen(false)
      setChecked(new Set())
    } catch (err) {
      toast.error(extractError(err, '指派失败'))
    }
  }

  const onRemind = async (assignmentIds: number[]) => {
    if (assignmentIds.length === 0) return
    try {
      const res = await remindMut.mutateAsync({ assignment_ids: assignmentIds })
      toast.success(`已催审 ${res.reminded_count} 位审稿人`)
    } catch (err) {
      toast.error(extractError(err, '催审失败'))
    }
  }

  const onDecide = async () => {
    if (decidingId === null) return
    if (decision === 'accept' && waiveReview && waiveReason.trim().length < 10) {
      toast.error('免评审理由至少 10 个字，会写入审计与作者通知')
      return
    }
    try {
      if (decision === 'accept' && waiveReview) {
        await waiveMut.mutateAsync({
          id: decidingId,
          reason: waiveReason.trim(),
        })
      }
      await decisionMut.mutateAsync({
        id: decidingId,
        body: { decision, editor_note: editorNote || undefined },
      })
      toast.success('已记录编辑决定')
      setDecidingId(null)
      setEditorNote('')
      setWaiveReview(false)
      setWaiveReason('')
    } catch (err) {
      toast.error(extractError(err, '裁决失败'))
    }
  }

  const openDecide = (submissionId: number) => {
    setDecidingId(submissionId)
    setDecision('major_revision')
    setEditorNote('')
    setWaiveReview(false)
    setWaiveReason('')
  }

  return (
    <div>
      <PageHeader
        title="主编工作台"
        description="五栏流水线：待指派 → 评审中 → 返修中 → 待裁决 → 已决定。"
        actions={
          <>
            <Link to="/editor/triage">
              <Button variant="outline" size="sm">
                <FileText className="mr-1 h-4 w-4" aria-hidden />
                初筛队列
              </Button>
            </Link>
            <Link to="/editor/calibration">
              <Button variant="outline" size="sm">
                季度校准
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={() => setReportsOpen(true)}>
              <Search className="mr-1 h-4 w-4" aria-hidden />
              审稿意见检索
            </Button>
          </>
        }
      />

      {/* 批量指派条放在顶部：待指派列表可能很长，按钮不能沉到列表底部。 */}
      {columns && columns.to_assign.count > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3 shadow-sm">
          <span className="text-sm text-muted-foreground">
            待指派 {columns.to_assign.count} 篇 · 已勾选{' '}
            <span className="font-semibold text-foreground">{checked.size}</span> 篇
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setChecked(new Set())}
              disabled={checked.size === 0}
            >
              清空
            </Button>
            <Button
              onClick={() => openAssignDialog()}
              disabled={checked.size === 0 || batchMut.isPending}
            >
              <UserPlus className="h-4 w-4" /> 批量指派
            </Button>
          </div>
        </div>
      )}

      {columns && (columns.to_assign.has_more || columns.in_review.has_more || columns.rework.has_more || columns.to_decide.has_more || columns.decided.has_more) && (
        <p className="mb-3 text-xs text-muted-foreground">
          每栏最多展示 50 篇；当前共 待指派 {columns.to_assign.count} / 评审中 {columns.in_review.count} / 返修中 {columns.rework.count} / 待裁决 {columns.to_decide.count} / 已决定 {columns.decided.count} 篇。
        </p>
      )}

      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <HelpTip text="指派前先看利益冲突；裁决必须写 20 字以上处置说明；撤回申诉受理后作品会下架，分数/分区重审要记录结论。" />
        指派、裁决、申诉处置的边界
      </p>

      {/* 邮件摘要状态条：诚实报告"邮件到底有没有发出去"。
          站内通知照常，邮件侧若没配 SMTP 必须明说，不能写成"已通知"。 */}
      {digest && digestTone !== 'idle' && (
        <div className="mb-4 overflow-hidden rounded-lg border">
          <div
            className={
              digestTone === 'amber'
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200'
                : digestTone === 'red'
                  ? 'border-red-300 bg-red-50 text-red-900 dark:bg-red-950/20 dark:text-red-200'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200'
            }
          >
            <div className="flex items-start gap-2 px-4 py-2.5 text-sm">
              {digestTone === 'amber' && <MailWarning className="mt-0.5 h-4 w-4 shrink-0" />}
              {digestTone === 'red' && <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              {digestTone === 'green' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
              <div className="min-w-0 flex-1">
                {digestTone === 'amber' && (
                  <p className="font-medium">
                    邮件摘要未发送：服务器未配置 SMTP，已记录 {digest.skipped_count} 条待发摘要，仅站内通知生效。
                  </p>
                )}
                {digestTone === 'red' && (
                  <p className="font-medium">
                    邮件摘要发送失败：最近一次尝试{' '}
                    {digest.last_attempt_at
                      ? new Date(digest.last_attempt_at).toLocaleString()
                      : '未知'}
                    ，近 30 天共 {digest.failed_count} 条投递失败。站内通知不受影响。
                  </p>
                )}
                {digestTone === 'green' && (
                  <p className="font-medium">
                    邮件摘要已发送
                    {digest.last_attempt_at
                      ? `（最近 ${new Date(digest.last_attempt_at).toLocaleString()}）`
                      : ''}
                    。
                  </p>
                )}
              </div>
              {digestTone !== 'green' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => setDigestOpen((v) => !v)}
                >
                  {digestOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  查看记录
                </Button>
              )}
            </div>

            {digestTone !== 'green' && digestOpen && (
              <div className="border-t border-current/10 px-4 py-2 text-xs">
                {digestRecords.isLoading ? (
                  <p className="py-2 text-muted-foreground">加载记录中…</p>
                ) : digestRecords.isError ? (
                  <p className="py-2 text-muted-foreground">记录加载失败</p>
                ) : (digestRecords.data?.items.length ?? 0) === 0 ? (
                  <p className="py-2 text-muted-foreground">暂无投递记录</p>
                ) : (
                  <ul className="max-h-64 space-y-1 overflow-y-auto py-1">
                    {(digestRecords.data?.items ?? []).map((r) => (
                      <li key={r.id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-black/5 dark:hover:bg-white/5">
                        <Badge
                          variant="outline"
                          className={
                            r.status === 'sent'
                              ? 'border-emerald-400 text-emerald-700 dark:text-emerald-300'
                              : r.status === 'failed'
                                ? 'border-red-400 text-red-700 dark:text-red-300'
                                : 'border-amber-400 text-amber-700 dark:text-amber-300'
                          }
                        >
                          {r.status}
                        </Badge>
                        <span className="truncate" title={r.subject}>
                          {r.subject}
                        </span>
                        <span className="ml-auto shrink-0 text-muted-foreground">
                          {r.recipient_email} · {new Date(r.created_at).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {workload.data && workload.data.length > 0 && (
        <Card className="mb-4">
          <CardContent className="py-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" />
              审稿人负载
              <span className="text-xs font-normal text-muted-foreground">按接受中任务排序</span>
            </div>
            <div className="max-h-56 overflow-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b text-left">
                    <th className="py-1 pr-3 font-normal">审稿人</th>
                    <th className="py-1 pr-3 font-normal">接受中</th>
                    <th className="py-1 pr-3 font-normal">已完成</th>
                    <th className="py-1 pr-3 font-normal">已逾期</th>
                    <th className="py-1 font-normal">累计邀请</th>
                  </tr>
                </thead>
                <tbody>
                  {workload.data.map((r) => (
                    <tr key={r.reviewer_id} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-3">{r.username}</td>
                      <td className="py-1.5 pr-3 font-medium">{r.active_count}</td>
                      <td className="py-1.5 pr-3">{r.completed_count}</td>
                      <td className={`py-1.5 pr-3 ${r.overdue_count > 0 ? 'font-semibold text-red-600' : ''}`}>
                        {r.overdue_count}
                      </td>
                      <td className="py-1.5">{r.total_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : isError ? (
        <ErrorState message="加载失败" onRetry={() => refetch()} />
      ) : !columns ? (
        <EmptyState title="暂无数据" />
      ) : (
        <>
          {/* 桌面四列 / 移动横向滚动 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {COLUMN_META.map((col) => {
              const bucket = columns[col.key]
              return (
                <div key={col.key} className="space-y-2">
                  <div
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium ${col.accent}`}
                  >
                    <span>{col.title}</span>
                    <Badge variant="secondary">{bucket.count}</Badge>
                  </div>
                  {bucket.items.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      — 空 —
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {bucket.items.map((item) => (
                        <Card
                          key={item.submission_id}
                          className={
                            item.is_overdue
                              ? 'border-red-400 bg-red-50/50 dark:bg-red-950/10'
                              : undefined
                          }
                        >
                          <CardContent className="space-y-2 py-3 text-sm">
                            <div className="flex items-start gap-2">
                              {col.key === 'to_assign' && (
                                <input
                                  type="checkbox"
                                  checked={checked.has(item.submission_id)}
                                  onChange={() => toggleCheck(item.submission_id)}
                                  className="mt-1 h-4 w-4 shrink-0"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">
                                  {item.title ?? `#${item.submission_id}`}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {item.type ?? '未分类'} · 提交于{' '}
                                  {new Date(item.submitted_at).toLocaleDateString()}
                                </p>
                                {(col.key === 'to_assign' || col.key === 'in_review') && (item.interest_count ?? 0) > 0 && (
                                  <div className="mt-1 rounded bg-emerald-50/70 px-2 py-1 text-[11px] text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
                                    有 {item.interest_count} 人申请审稿
                                    {item.interesters?.length
                                      ? `：${item.interesters.join('、')}`
                                      : ''}
                                  </div>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mt-1 h-6 px-1 text-[11px] text-muted-foreground"
                                  onClick={() => setViewingId(item.submission_id)}
                                >
                                  <Eye className="h-3 w-3" /> 查看正文与审稿意见
                                </Button>
                              </div>
                            </div>

                            {(col.key === 'in_review' || col.key === 'to_assign') && item.assignments && (
                              <div className="space-y-1 border-t pt-2 text-xs">
                                {item.assignments.map((a) => (
                                  <div
                                    key={a.assignment_id}
                                    className={`flex items-center justify-between gap-2 rounded px-1 py-0.5 ${
                                      a.is_overdue
                                        ? 'bg-red-100/70 text-red-700 dark:bg-red-950/30'
                                        : ''
                                    }`}
                                  >
                                    <span className={`truncate ${a.status === 'declined' ? 'text-red-600' : ''}`}>
                                      {a.reviewer_username ?? `#${a.reviewer_id}`}
                                      {' · '}
                                      {a.status_label ?? (a.status === 'completed' ? '已交报告' : a.status === 'declined' ? '已拒审' : '未交')}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-1">
                                      {a.due_label && (
                                        <span
                                          className={
                                            a.is_overdue
                                              ? 'font-semibold text-red-600'
                                              : 'text-muted-foreground'
                                          }
                                        >
                                          <Clock className="inline h-3 w-3" /> {a.due_label}
                                        </span>
                                      )}
                                      {!a.completed_at && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 px-1 text-[10px]"
                                          onClick={() => onRemind([a.assignment_id])}
                                          disabled={remindMut.isPending}
                                        >
                                          <Send className="h-3 w-3" /> 催
                                        </Button>
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {col.key === 'rework' && (
                              <div className="space-y-2 border-t pt-2 text-xs">
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="outline">
                                    {item.status === 'major_revision'
                                      ? '大修'
                                      : item.status === 'minor_revision'
                                        ? '小修'
                                        : '已返修待审'}
                                  </Badge>
                                  {item.editor_note ? (
                                    <span className="line-clamp-2 text-muted-foreground">
                                      编辑备注：{item.editor_note}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">编辑未填备注</span>
                                  )}
                                </div>
                                {item.author_response ? (
                                  <div className="rounded bg-muted/40 p-2 text-muted-foreground">
                                    <span className="font-medium text-foreground">作者返修说明：</span>
                                    <span className="line-clamp-3 whitespace-pre-wrap">{item.author_response}</span>
                                  </div>
                                ) : (
                                  <p className="text-muted-foreground">作者尚未提交返修说明。</p>
                                )}
                              </div>
                            )}

                            {col.key === 'in_review' && item.assignments && item.assignments.some(
                              (a) => a.status === 'pending' || a.status === 'accepted',
                            ) && (
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="w-full"
                                  onClick={() => void openAssignDialog([item.submission_id])}
                                >
                                  <UserPlus className="h-3 w-3" /> 追加审稿人
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="w-full"
                                  onClick={() => {
                                    const active = (item.assignments ?? []).filter(
                                      (a) => a.status === 'pending' || a.status === 'accepted',
                                    )
                                    setReplaceTarget({
                                      submissionId: item.submission_id,
                                      assignmentIds: active.map((a) => a.assignment_id),
                                      names: active
                                        .map((a) => a.reviewer_username ?? `#${a.reviewer_id}`)
                                        .join('、'),
                                    })
                                  }}
                                >
                                  更换审稿人
                                </Button>
                              </div>
                            )}

                            {col.key === 'in_review' && (item.completed_count ?? 0) >= 1 && (
                              <Button
                                size="sm"
                                className="w-full"
                                onClick={() => openDecide(item.submission_id)}
                              >
                                <Gavel className="h-3 w-3" /> 提前裁决（已有 {item.completed_count} 份意见）
                              </Button>
                            )}

                            {col.key === 'to_assign' && item.needs_reassign && (
                              <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950/20">
                                {item.reassign_reason ?? '需要改派审稿人'}
                                {item.declined_count ? ` · 已拒审 ${item.declined_count} 人` : ''}
                              </p>
                            )}
                            {col.key === 'to_assign' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full"
                                onClick={() => openAssignDialog([item.submission_id])}
                              >
                                <UserPlus className="h-3 w-3" /> {item.needs_reassign ? '改派 / 补派审稿人' : '指派审稿人'}
                              </Button>
                            )}

                            {col.key === 'to_decide' && item.recommendations && (
                              <div className="space-y-1 border-t pt-2 text-xs">
                                {item.recommendations.map((r) => (
                                  <div key={r.reviewer_id} className="flex items-center gap-2">
                                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                    <span>审稿人 {r.reviewer_username ?? `#${r.reviewer_id}`}</span>
                                    <Badge variant="outline">{r.recommendation ?? '—'}</Badge>
                                  </div>
                                ))}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="mt-1 w-full"
                                  onClick={() => setViewingId(item.submission_id)}
                                >
                                  <FileText className="h-3 w-3" /> 查看正文与审稿意见
                                </Button>
                                <Button
                                  size="sm"
                                  className="mt-1 w-full"
                                  onClick={() => openDecide(item.submission_id)}
                                >
                                  <Gavel className="h-3 w-3" /> 裁决
                                </Button>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

        </>
      )}

      {/* 批量指派弹层 */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{checked.size > 1 ? '批量指派审稿人' : '指派审稿人'}</DialogTitle>
            <DialogDescription>
              已选 {checked.size} 篇稿件。黄色警告为利益冲突项，默认不选。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {checkedDisciplineSlug && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={onlySameDiscipline}
                  onChange={(e) => setOnlySameDiscipline(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                只看自选「{checkedDiscipline}」学科的审稿人
              </label>
            )}
            <div className="max-h-72 space-y-1 overflow-y-auto rounded border p-2">
              {dialogCandidates.length === 0 && (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  {onlySameDiscipline && allCandidates.length > 0
                    ? '没有自选该学科的审稿人；取消筛选可查看全部候选。'
                    : '暂无候选审稿人：请先在「用户管理」里授予审稿人角色。'}
                </p>
              )}
              {dialogCandidates.map((c) => {
                const conflict = conflicts[c.id]
                const warned = conflict?.warning
                const disabled = conflict?.is_submitter || conflict?.name_matches_author
                return (
                  <label
                    key={c.id}
                    className={`flex items-start gap-2 rounded px-2 py-1.5 text-sm ${
                      warned ? 'bg-amber-50 dark:bg-amber-950/20' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedReviewers.includes(c.id)}
                      onChange={() => onToggleReviewer(c.id)}
                      disabled={disabled}
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span>{c.username}</span>
                        {(c.reviewer_disciplines ?? []).slice(0, 2).map((slug) => (
                          <Badge
                            key={slug}
                            variant="outline"
                            className="border-primary/40 text-[10px] text-primary"
                          >
                            {disciplineNames.get(slug) ?? slug}
                          </Badge>
                        ))}
                        {(c.reviewer_tags ?? []).slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                        {warned && (
                          <Badge variant="outline" className="text-amber-700">
                            <AlertTriangle className="h-3 w-3" /> 冲突
                          </Badge>
                        )}
                      </div>
                      {conflict?.warnings && conflict.warnings.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-[11px] text-amber-700">
                          {conflict.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="due-days" className="shrink-0">
                截止天数
              </Label>
              <Input
                id="due-days"
                type="number"
                min={1}
                max={90}
                value={dueDays}
                onChange={(e) => setDueDays(Number(e.target.value) || 14)}
                className="w-24"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              取消
            </Button>
            <Button onClick={onBatchAssign} disabled={batchMut.isPending || selectedReviewers.length === 0}>
              {batchMut.isPending ? '指派中…' : `指派给 ${selectedReviewers.length} 位审稿人`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditorReportSearchDialog
        open={reportsOpen}
        query={reportsQuery}
        onQuery={setReportsQuery}
        onOpenSubmission={(sid) => {
          setReportsOpen(false)
          setViewingId(sid)
        }}
        onClose={() => setReportsOpen(false)}
      />

      {/* 查看稿件弹层：主编裁决前先读完整正文 */}
      <EditorManuscriptDialog
        submissionId={viewingId}
        onClose={() => setViewingId(null)}
      />

      {/* 裁决弹层 */}
      <Dialog
        open={decidingId !== null}
        onOpenChange={(o) => !o && setDecidingId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑裁决</DialogTitle>
            <DialogDescription>稿件 #{decidingId}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[40vh] space-y-3 overflow-y-auto pr-1">
            {decidingId !== null && (
              <>
                <SubmissionAuthorResponsePanel submissionId={decidingId} />
                <SubmissionReportsPanel submissionId={decidingId} />
              </>
            )}
            <div className="space-y-1">
              <Label>决定</Label>
              <Select
                value={decision}
                onValueChange={(v) => setDecision(v as typeof decision)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="accept">录用</SelectItem>
                  <SelectItem value="minor_revision">小修</SelectItem>
                  <SelectItem value="major_revision">大修</SelectItem>
                  <SelectItem value="reject">拒稿</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {decision === 'accept' && (
              <div className="space-y-2 rounded-md border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/20">
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={waiveReview}
                    onChange={(e) => setWaiveReview(e.target.checked)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    <span className="font-medium">该稿免同行评审（编辑直接录用）</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      仅用于约稿、编委特稿、重复发表复核等确实无需外审的稿件；会写审计并通知作者。
                    </span>
                  </span>
                </label>
                {waiveReview && (
                  <div className="space-y-1">
                    <Label htmlFor="waive-reason">免评审理由（至少 10 字）</Label>
                    <Input
                      id="waive-reason"
                      value={waiveReason}
                      onChange={(e) => setWaiveReason(e.target.value)}
                      placeholder="例如：编委特稿，已由两位编委完成内部复核"
                    />
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="editor-note">给作者的说明（可选）</Label>
              <Input
                id="editor-note"
                value={editorNote}
                onChange={(e) => setEditorNote(e.target.value)}
                placeholder="将随决定通知发送给作者"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecidingId(null)}>
              取消
            </Button>
            <Button
              onClick={onDecide}
              disabled={decisionMut.isPending || (decision === 'accept' && waiveReview && waiveMut.isPending)}
            >
              {decisionMut.isPending || (decision === 'accept' && waiveReview && waiveMut.isPending)
                ? '提交中…'
                : decision === 'accept' && waiveReview
                  ? '记录免评审并录用'
                  : '提交决定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={replaceTarget !== null}
        title="更换审稿人"
        description={
          replaceTarget
            ? `将撤回 ${replaceTarget.names || '当前审稿人'} 的在途邀请，再重新选择审稿人。已提交的审稿报告不会被删除。`
            : undefined
        }
        confirmText="撤回并重新指派"
        destructive
        onConfirm={() => void onConfirmReplace()}
        onOpenChange={(o) => !o && setReplaceTarget(null)}
      />
    </div>
  )
}


const RECOMMENDATION_LABELS: Record<string, string> = {
  accept: '录用',
  minor_revision: '小修',
  major_revision: '大修',
  reject: '拒稿',
}

function reportScore(scores: Record<string, unknown>): string | null {
  const raw = scores?.score
  if (typeof raw === 'number') return raw.toFixed(1)
  if (typeof raw === 'string' && raw.trim()) return raw
  return null
}

function SubmissionReportsPanel({ submissionId }: { submissionId: number }) {
  const { data, isLoading, isError, refetch } = useSubmissionReports(submissionId)
  if (isLoading) return <LoadingSkeleton rows={2} />
  if (isError)
    return (
      <ErrorState message="审稿意见加载失败" onRetry={() => void refetch()} />
    )
  if (!data || data.length === 0) {
    return (
      <p className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        尚无已完成的审稿报告；裁决前应先等至少两份意见。
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileText className="h-4 w-4" /> 审稿意见
        <Badge variant="secondary">{data.length} 份</Badge>
      </div>
      {data.map((r, index) => (
        <div key={r.id} className="rounded-md border bg-card p-3 text-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-medium">
              审稿人 {r.reviewer_username ?? `#${r.reviewer_id ?? index + 1}`}
            </span>
            <Badge variant="outline">
              {RECOMMENDATION_LABELS[r.recommendation] ?? r.recommendation}
            </Badge>
            {reportScore(r.scores) && (
              <Badge variant="secondary">总分 {reportScore(r.scores)}</Badge>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {new Date(r.submitted_at).toLocaleString()}
            </span>
          </div>
          {r.comments_to_editor?.trim() ? (
            <div>
              <div className="text-xs text-muted-foreground">给编辑的机密意见</div>
              <p className="whitespace-pre-wrap leading-relaxed">{r.comments_to_editor}</p>
            </div>
          ) : null}
          {r.comments_to_author?.trim() ? (
            <div className="mt-2">
              <div className="text-xs text-muted-foreground">给作者的意见</div>
              <p className="whitespace-pre-wrap leading-relaxed">{r.comments_to_author}</p>
            </div>
          ) : null}
          {reviewDimensionEntries(r.scores).some(([, v]) => (v.suggestion ?? '').trim()) ? (
            <div className="mt-2 space-y-0.5 rounded bg-muted/40 p-2 text-xs">
              <div className="font-medium text-muted-foreground">逐维修改意见</div>
              {reviewDimensionEntries(r.scores)
                .filter(([, v]) => (v.suggestion ?? '').trim())
                .map(([k, v]) => (
                  <p key={k}>
                    <strong>{REVIEW_DIMENSION_LABELS[k] ?? k}</strong>：{v.suggestion}
                  </p>
                ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function SubmissionAuthorResponsePanel({ submissionId }: { submissionId: number }) {
  const { data } = useSubmission(submissionId)
  const text = data?.author_response?.trim()
  if (!text) return null
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 font-medium">
        <FileText className="h-4 w-4" /> 作者逐条回复审稿人
        {data?.author_response_at && (
          <span className="text-xs font-normal text-muted-foreground">
            {new Date(data.author_response_at).toLocaleString()}
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  )
}

function SubmissionTimelinePanel({ submissionId }: { submissionId: number }) {
  const { data, isLoading } = useSubmissionTimeline(submissionId, submissionId > 0)
  if (isLoading) return <LoadingSkeleton rows={2} />
  if (!data || data.events.length === 0) return null
  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <History className="h-4 w-4" /> 全流程追溯
        <span className="text-xs text-muted-foreground">投稿 → 版本 → 邀请/拒审 → 报告 → 裁决</span>
      </div>
      <ol className="space-y-1.5 border-l pl-3 text-xs">
        {data.events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="relative">
            <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-primary" />
            <div className="flex flex-wrap gap-2">
              <span className="text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
              <span className="font-medium">{e.title}</span>
            </div>
            {e.detail ? <p className="mt-0.5 text-muted-foreground">{e.detail}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  )
}

function EditorReportSearchDialog({
  open,
  query,
  onQuery,
  onOpenSubmission,
  onClose,
}: {
  open: boolean
  query: string
  onQuery: (value: string) => void
  onOpenSubmission: (submissionId: number) => void
  onClose: () => void
}) {
  const { data, isLoading } = useEditorReportSearch(query)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>审稿意见检索</DialogTitle>
          <DialogDescription>
            按论文标题、审稿人用户名或意见正文搜索全部已完成报告；只返回编辑可见内容。
          </DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="例如：稳健性检验 / 张三 / 样本量"
          autoFocus
        />
        {isLoading ? (
          <LoadingSkeleton rows={3} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="没有匹配的审稿意见" description="换一个标题关键词或审稿人用户名。" />
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            <p className="text-xs text-muted-foreground">命中 {data.count} 条</p>
            {data.items.map((item) => (
              <div key={item.report_id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.submission_title}</span>
                  <Badge variant="outline">
                    {RECOMMENDATION_LABELS[item.recommendation] ?? item.recommendation}
                  </Badge>
                  <Badge variant="secondary">第 {item.round} 轮</Badge>
                  {item.score != null && <Badge variant="outline">总分 {item.score}</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.reviewer_username ?? `#${item.reviewer_id}`} ·{' '}
                    {new Date(item.submitted_at).toLocaleString()}
                  </span>
                </div>
                {item.comments_to_editor?.trim() && (
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                    给编辑：{item.comments_to_editor}
                  </p>
                )}
                {item.comments_to_author?.trim() && (
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs">
                    给作者：{item.comments_to_author}
                  </p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => onOpenSubmission(item.submission_id)}
                >
                  打开稿件与全部意见
                </Button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditorManuscriptDialog({
  submissionId,
  onClose,
}: {
  submissionId: number | null
  onClose: () => void
}) {
  const subQ = useSubmission(submissionId ?? 0)
  const mdQ = useSubmissionMarkdown(
    submissionId ?? 0,
    submissionId !== null && !!subQ.data?.markdown_path,
  )
  const pdfTicket = useSubmissionDownloadTicket(submissionId ?? 0, 'pdf', submissionId !== null)
  const docxTicket = useSubmissionDownloadTicket(submissionId ?? 0, 'docx', submissionId !== null)
  const data = subQ.data

  return (
    <Dialog open={submissionId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>查看稿件</DialogTitle>
          <DialogDescription>
            裁决前先读正文、摘要与审稿意见；Markdown 稿直接读全文，PDF/Word 稿可在线打开原件。
          </DialogDescription>
        </DialogHeader>
        {subQ.isLoading ? (
          <LoadingSkeleton rows={4} />
        ) : subQ.isError ? (
          <ErrorState message="加载稿件失败" onRetry={() => subQ.refetch()} />
        ) : !data ? null : (
          <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1 text-sm">
            <div>
              <h3 className="text-base font-semibold leading-snug">{data.title}</h3>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge variant="secondary">{data.type}</Badge>
                <Badge variant="outline">{data.discipline}</Badge>
                {data.subdiscipline && <Badge variant="outline">{data.subdiscipline}</Badge>}
                <Badge variant="outline">状态：{data.status}</Badge>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">作者</div>
              <div>{(data.authors ?? []).join(' · ') || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">摘要</div>
              <p className="whitespace-pre-wrap leading-relaxed">{data.abstract || '—'}</p>
            </div>
            {mdQ.data?.content ? (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">正文</div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <MarkdownContent text={mdQ.data.content} className="text-sm leading-relaxed" />
                </div>
              </div>
            ) : data.preview ? (
              <div>
                <div className="text-xs text-muted-foreground">
                  正文预览（若为 PDF/Word 稿，请用下方按钮打开全文）
                </div>
                <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {data.preview}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {pdfTicket.data ? (
                <a
                  href={pdfTicket.data}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-sm font-medium hover:bg-muted"
                >
                  <FileText className="h-4 w-4" /> 在线打开 PDF
                </a>
              ) : null}
              {docxTicket.data ? (
                <a
                  href={docxTicket.data}
                  download
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-sm font-medium hover:bg-muted"
                >
                  <FileText className="h-4 w-4" /> 下载 Word
                </a>
              ) : null}
              {!mdQ.data?.content && !pdfTicket.data && !docxTicket.data ? (
                <span className="text-xs text-muted-foreground">该稿件暂无可打开的原件。</span>
              ) : null}
            </div>
            {data.author_response?.trim() ? (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <FileText className="h-4 w-4" /> 作者逐条回复审稿人
                  {data.author_response_at && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {new Date(data.author_response_at).toLocaleString()}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{data.author_response}</p>
              </div>
            ) : null}
            <SubmissionReportsPanel submissionId={data.id} />
            <SubmissionTimelinePanel submissionId={data.id} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
