import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate, useSearch } from '@tanstack/react-router'
import {
  ClipboardList,
  Columns3,
  Download,
  Eye,
  FileText,
  Gavel,
  Save,
  ShieldCheck,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { waitingChip } from '@/components/common/waiting-chip'
import { TriageQueue } from '@/components/editor/triage-queue'
import { EditorPipeline } from '@/components/editor/workbench-pipeline'
import { RevisionEvidencePanel } from '@/components/editor/revision-evidence'
import { getAuthState } from '@/lib/auth'
import { normalizeAbstract } from '@/lib/abstract'
import { useAuth } from '@/hooks/use-auth'
import {
  downloadSubmissionFile,
  useAllSubmissions,
  useAssignAdjudicator,
  useAssignReviewersBulk,
  useCancelAssignment,
  useDisciplines,
  useEditorDecision,
  useSetAnonymizedFile,
  useSubmission,
  useSubmissionAssignments,
  useSubmissionOverview,
  useSubmissionReports,
  useSubmissionVersions,
  useReviewMatrix,
  useReviewerCandidates,
  usePutAuthors,
  type ReviewerCandidate,
} from '@/hooks/api/use-modules'
import type {
  AssignmentResponse,
  AuthorEditInput,
  EditorDecision,
  ReviewMatrixResponse,
  ReviewReportResponse,
  SubmissionResponse,
  SubmissionStatus,
} from '@/lib/types'
import { typeLabel } from '@/lib/resource-labels'
import {
  REVIEW_DIMENSION_LABELS as SCORE_LABELS,
  reviewDimensionEntries as reportDimensionEntries,
} from '@/lib/review-dimensions'
import { extractError, formatDateTime } from '@/lib/utils'
import { canDirectAcceptRevision, isRevisionSubmission } from '@/lib/revision'
import { canFinalDecision } from '@/lib/editor-roles'
import { PageHeader } from '@/components/common/page-header'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { useRequestRework } from '@/hooks/api/use-modules'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AuthorEditor } from '@/components/common/author-editor'
import { ReviewAttachmentLinks } from '@/components/common/review-attachments'
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// 指派互评成员时取多少候选。超出时 UI 会明确提示"只取了前 N 个"，
// 避免目标互评成员只是没被列出来却被当成"不存在"。
const REVIEWER_CANDIDATE_LIMIT = 200

export const Route = createFileRoute('/submissions/pending')({
  beforeLoad: () => {
    // 内容台对 editor / section_editor / admin 开放；具体权限由后端
    // require_editor 强制，这里只挡掉完全无关的访客与普通作者。
    const { isAuthenticated, isAdmin, user } = getAuthState()
    if (!isAuthenticated) throw redirect({ to: '/login' })
    const roles = user?.roles ?? []
    if (
      !isAdmin &&
      !roles.some((r) =>
        [
          'editor',
          'section_editor',
          'board_editor',
          'deputy_editor',
          'chief_editor',
          'editor_in_chief',
        ].includes(r),
      )
    ) {
      throw redirect({ to: '/me' })
    }
  },
  component: PendingPage,
})

const DECISION_OPTIONS: { value: EditorDecision; label: string; hint?: string }[] = [
  { value: 'accept', label: '通过', hint: '自动公开' },
  { value: 'minor_revision', label: '小改' },
  { value: 'major_revision', label: '大改' },
  { value: 'reject', label: '不通过' },
]

const RECOMMENDATION_LABELS: Record<string, string> = {
  accept: '通过',
  minor_revision: '小改',
  major_revision: '大改',
  reject: '不通过',
}

function recommendationLabel(value: string): string {
  return RECOMMENDATION_LABELS[value] ?? value
}

// 条目中文口径统一在 @/lib/review-dimensions，旧四维作为历史数据兜底。
// 内容台状态 tab：全部 + 各 submission status + 返修稿（版本口径）
type StatusTab = SubmissionStatus | 'all' | 'revision'
const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待分配' },
  { value: 'under_review', label: '互评中' },
  { value: 'revision', label: '返修稿' },
  { value: 'major_revision', label: '大改' },
  { value: 'minor_revision', label: '小改' },
  { value: 'rework_requested', label: '待修改' },
  { value: 'accepted', label: '已通过' },
  { value: 'rejected', label: '已不通过' },
]

interface PendingSearch {
  status?: StatusTab
  page?: number
  stage?: 'triage' | 'pipeline'
  /** 通知深链：直接打开某份作品，不用在长列表里找。 */
  submission?: number
}

function statusBadge(
  status: string,
  resourcePublicationStatus?: string | null,
  latestVersion?: number,
) {
  switch (status) {
    case 'pending':
      return <Badge variant="secondary">待分配</Badge>
    case 'under_review':
      if ((latestVersion ?? 1) > 1) {
        return (
          <Badge className="bg-violet-500/15 text-violet-700">
            返修稿 v{latestVersion}
          </Badge>
        )
      }
      return <Badge className="bg-primary/15 text-primary">互评中</Badge>
    case 'major_revision':
      return <Badge className="bg-amber-500/15 text-amber-700">大改</Badge>
    case 'minor_revision':
      return <Badge className="bg-yellow-500/15 text-yellow-700">小改</Badge>
    case 'rework_requested':
      return <Badge className="bg-sky-500/15 text-sky-700">待修改</Badge>
    case 'resubmitted':
      return <Badge className="bg-primary/15 text-primary">修改版</Badge>
    case 'accepted':
    case 'approved':
      if (resourcePublicationStatus === 'draft') {
        return <Badge className="bg-amber-500/15 text-amber-700">已通过 · 草稿</Badge>
      }
      if (resourcePublicationStatus === 'published') {
        return <Badge className="bg-emerald-500/15 text-emerald-700">已公开</Badge>
      }
      return <Badge className="bg-emerald-500/15 text-emerald-700">已通过</Badge>
    case 'rejected':
      return <Badge variant="destructive">已不通过</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function reminderBadge(count?: number, lastAt?: string | null) {
  if (!count || count < 1) return null
  return (
    <Badge
      variant="outline"
      className="text-[10px] text-amber-700"
      title={lastAt ? `最近催办：${formatDateTime(lastAt)}` : undefined}
    >
      已催 {count} 次
    </Badge>
  )
}

function assignmentStatusBadge(status: string) {
  switch (status) {
    case 'pending':
      return <Badge variant="secondary">待回应</Badge>
    case 'accepted':
      return <Badge className="bg-primary/15 text-primary">已接受</Badge>
    case 'declined':
      return (
        <Badge variant="outline" className="border-amber-500/40 text-amber-600">
          待重新指派
        </Badge>
      )
    case 'completed':
      return <Badge className="bg-emerald-500/15 text-emerald-700">已完成</Badge>
    case 'cancelled':
      return <Badge variant="outline">已撤销</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

interface DecisionFormState {
  decision: EditorDecision
  editor_note: string
  /** 互评意见冲突时必填的复核理由 */
  arbitration_note: string
  /** 返修稿由主编直接录用，跳过本轮“必须有通过意见”的闸门 */
  accept_after_revision: boolean
  /** 质量分低于 40 时仍破例录用；必须填写备注理由 */
  force_accept_d_grade: boolean
}

const EMPTY_DECISION: DecisionFormState = {
  decision: 'minor_revision',
  editor_note: '',
  arbitration_note: '',
  accept_after_revision: false,
  force_accept_d_grade: false,
}

// 决策按钮只按作品状态开关；真正的“≥1 位互评成员通过 / 冲突须复核”闸门由矩阵弹窗
// 展示、由后端复核端点强制。此前用列表里的 reports_completed 判断，
// 但该字段后端从未返回，按钮永远是灰的——内容整理根本点不开决定。
function canOpenDecision(s: SubmissionResponse): boolean {
  return ['pending', 'under_review', 'resubmitted'].includes(s.status)
}

function decisionDisabledReason(s: SubmissionResponse): string | undefined {
  return canOpenDecision(s) ? undefined : '当前状态不可复核'
}

function PendingPage() {
  const search = useSearch({ strict: false }) as PendingSearch
  if (search.stage === 'triage') return <TriageQueue />
  if (search.stage === 'pipeline') return <EditorPipeline />
  return <PendingSubmissionsPage />
}

function PendingSubmissionsPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as PendingSearch
  const statusTab = (search.status ?? 'all') as StatusTab
  const page = search.page ?? 1
  // 'all' tab 不传 status，让后端返回全部状态
  const statusFilter = statusTab === 'all' ? undefined : statusTab
  // 职权分离（与后端 require_chief_editor 同口径）：最终通过 / 修改 / 不通过
  // 是内容整理（L8）的职权；分类整理（L7）只有初审、互评与推荐权。
  const { isAdmin, user } = useAuth()
  const authRoles = user?.roles ?? []
  // 与后端 require_chief_editor 对齐：只有 chief/deputy（新轴 editor_in_chief）
  // 有最终裁决权；普通 editor / section_editor / board_editor 只能初审、分派、
  // 推荐，不能做最终决定。
  const isChief = canFinalDecision(isAdmin, authRoles)
  const isSectionOnly =
    !isChief &&
    authRoles.some((r) =>
      ['editor', 'section_editor', 'board_editor'].includes(r),
    )

  const { data: overview } = useSubmissionOverview()
  const { data, isLoading, isError, refetch } = useAllSubmissions(
    statusFilter,
    page,
    10,
  )
  const linkedSubmissionId = Number(search.submission ?? 0)
  const linkedSubmission = useSubmission(linkedSubmissionId)
  const decisionMut = useEditorDecision()

  const [detail, setDetail] = useState<SubmissionResponse | null>(null)
  const linkedDetailApplied = useRef(0)
  useEffect(() => {
    if (!linkedSubmissionId || linkedDetailApplied.current === linkedSubmissionId) return
    if (!linkedSubmission.data) return
    linkedDetailApplied.current = linkedSubmissionId
    setDetail(linkedSubmission.data)
  }, [linkedSubmissionId, linkedSubmission.data])
  const [assignTarget, setAssignTarget] = useState<SubmissionResponse | null>(null)
  const [assignmentsTarget, setAssignmentsTarget] = useState<SubmissionResponse | null>(null)
  const [decisionTarget, setDecisionTarget] = useState<SubmissionResponse | null>(null)
  // D 级打回：展开/收起 + 逐行填写的修改要求
  const [reworkOpen, setReworkOpen] = useState(false)
  const [reworkRequirements, setReworkRequirements] = useState('')
  const reworkMut = useRequestRework()
  // 不通过是终态决定，二次确认后才真正执行
  const [rejectConfirm, setRejectConfirm] = useState(false)
  const [reportsTarget, setReportsTarget] = useState<SubmissionResponse | null>(null)
  // 匿名互评的匿名稿外链：只有内容整理能写，互评成员取作品只认这个链接
  const [anonymizedTarget, setAnonymizedTarget] = useState<SubmissionResponse | null>(
    null,
  )
  const [decisionForm, setDecisionForm] = useState<DecisionFormState>(EMPTY_DECISION)
  // 做决定时内嵌互评报告概要：推荐 + 评分 + 内容整理保密意见，内容整理不必另开弹窗
  const decisionReportsQ = useSubmissionReports(decisionTarget?.id ?? 0)
  const decisionMatrixQ = useReviewMatrix(decisionTarget?.id ?? 0)
  // v2+ = 作者已经返修重投过；只有 under_review 才允许“返修后直接录用”。
  const isRevision = isRevisionSubmission(decisionTarget?.latest_version)
  // 补材料重投会落到 resubmitted（先回基础检查），还没重新进入互评复核；
  // 这种稿子可以显示为返修稿，但不能用“跳过本轮互评”的直接录用开关。
  const canDirectAccept = canDirectAcceptRevision(
    decisionTarget?.status,
    decisionTarget?.latest_version,
  )

  const updateSearch = (patch: Partial<PendingSearch>) => {
    void navigate({
      to: '/submissions/pending',
      search: { ...search, ...patch },
      replace: true,
    })
  }

  const closeDetail = () => {
    setDetail(null)
    linkedDetailApplied.current = 0
    if (search.submission) updateSearch({ submission: undefined })
  }

  const onConfirmDecision = async () => {
    if (!decisionTarget) return
    const target = decisionTarget
    // 不通过：先弹二次确认（终态操作，误触会直接断送作者的这次发布）
    if (decisionForm.decision === 'reject') {
      setRejectConfirm(true)
      return
    }
    await doDecision(target)
  }

  const doDecision = async (target: SubmissionResponse) => {
    const matrix = decisionMatrixQ.data
    const directAccept =
      decisionForm.decision === 'accept' &&
      decisionForm.accept_after_revision &&
      canDirectAccept
    if (decisionForm.decision === 'accept' && !directAccept) {
      if (!matrix) {
        toast.error('互评进度还没读完，请稍等再试。')
        return
      }
      if (matrix.accept_count < 1) {
        toast.error(
          `公开需要至少 1 名互评成员给出通过推荐，当前还没有通过推荐。`,
        )
        return
      }
      if (matrix.conflict && !matrix.adjudicator_accepted) {
        toast.error('互评意见冲突：请先指定第三方复核人并等待其通过意见。')
        return
      }
    }
    // 冲突时必须填复核理由；返修稿直接录用本身就是主编复核动作，
    // 不强制填冲突理由，但会在 editor_note 里自动留痕。
    if (!directAccept && matrix?.conflict && !decisionForm.arbitration_note.trim()) {
      toast.error('互评意见冲突：请填写复核理由')
      return
    }
    if (
      decisionForm.decision === 'accept' &&
      decisionForm.force_accept_d_grade &&
      !decisionForm.editor_note.trim()
    ) {
      toast.error('低于 40 分破例录用必须在内容整理备注里写明理由')
      return
    }
    try {
      await decisionMut.mutateAsync({
        id: target.id,
        body: {
          decision: decisionForm.decision,
          editor_note: decisionForm.editor_note || undefined,
          arbitration_note:
            target.conflict ? decisionForm.arbitration_note : undefined,
          accept_after_revision: directAccept || undefined,
          force_accept_d_grade:
            decisionForm.decision === 'accept' &&
            decisionForm.force_accept_d_grade
              ? true
              : undefined,
        },
      })
      toast.success('决定已记录')
      setDecisionTarget(null)
      setDecisionForm(EMPTY_DECISION)
    } catch (err) {
      toast.error(extractError(err, '没能记录处理决定，可再试一次'))
    }
  }

  return (
    <div>
      <PageHeader
        title="内容台"
        description={
          isChief
            ? '分配互评成员、查看互评意见、做最终决定。支持按状态筛选全部提交。'
            : '分配互评成员、查看互评意见、提交裁决建议。支持按状态筛选全部提交。'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/submissions/pending" search={{ stage: 'pipeline' }}>
                <Columns3 className="mr-1 h-4 w-4" />
                进度看板
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/submissions/pending" search={{ stage: 'triage' }}>
                <ClipboardList className="mr-1 h-4 w-4" />
                待处理
              </Link>
            </Button>
          </div>
        }
      />

      {overview && (
        <div className="mb-4 rounded-lg border border-border/70 bg-muted/30 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span><strong className="font-semibold tabular-nums">{overview.resource_total}</strong> 部作品</span>
            <span className="text-emerald-700 dark:text-emerald-400">{overview.published} 已公开</span>
            <span className="text-amber-700 dark:text-amber-400">{overview.draft} 草稿</span>
            <span className="text-muted-foreground">{overview.total} 条投稿记录</span>
            {overview.duplicate_accepted > 0 && (
              <span className="text-muted-foreground">
                “已通过”已折叠 {overview.duplicate_accepted} 条历史重复记录
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            投稿记录不等于已公开作品。通过只代表审稿流程完成；资源状态为“已公开”才进入内容库，
            “草稿”需要在资源详情里手动公开。
          </p>
        </div>
      )}

      {isSectionOnly && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          你以分类整理（L7）身份查看工作台：可以初审、分配互评成员并给出推荐意见，
          最终通过 / 修改 / 不通过决定由内容整理（L8）作出。
        </div>
      )}

      <Tabs
        value={statusTab}
        onValueChange={(v) =>
          updateSearch({ status: v as StatusTab, page: 1 })
        }
        className="mb-4"
      >
        <TabsList className="!h-auto min-h-9 w-full flex-wrap justify-start overflow-visible">
          {STATUS_TABS.map((t) => {
            const count = !overview
              ? null
              : t.value === 'all'
                ? overview.total
                : t.value === 'accepted'
                  ? overview.accepted_resources
                  : t.value === 'revision'
                    ? overview.revision_count
                    : (overview.status_counts[t.value] ?? 0)
            return (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {count !== null && (
                  <span className="ml-1 tabular-nums text-muted-foreground">{count}</span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="待处理队列加载失败，可重试。" onRetry={() => refetch()} />
      ) : !data || data.data.length === 0 ? (
        <EmptyState title="暂无待处理作品" description="新发布的作品会出现在这里；没有待办时不用停留。" />
      ) : (
        <div className="space-y-4">
          {data.data.map((s) => (
            <Card key={s.id} data-testid="submission-card">
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{s.title}</h3>
                    {statusBadge(s.status, s.resource_publication_status, s.latest_version)}
                    {['pending', 'under_review', 'resubmitted'].includes(s.status) &&
                      waitingChip(s.submitted_at)}
                    {s.status === 'accepted' &&
                      s.resource_publication_status === 'draft' &&
                      (s.resource_id ? (
                        <Link
                          to="/catalog/$resourceId"
                          params={{ resourceId: String(s.resource_id) }}
                          className="inline-flex items-center"
                          title="通过时选择了暂存：进入资源详情后可在「管理此条」里公开"
                        >
                          <span className="text-xs font-medium text-amber-700 underline decoration-amber-400 underline-offset-4 hover:text-amber-800">
                          发布前整理 →
                          </span>
                        </Link>
                      ) : (
                        <span className="text-xs font-medium text-amber-700">发布前整理</span>
                      ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{typeLabel(s.type)}</Badge>
                    <span>{s.discipline}</span>
                    <span>{s.year}</span>
                    <span>
                      提交于 {new Date(s.submitted_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {s.authors.join(', ')}
                </p>
                <p className="line-clamp-2 text-sm">{s.abstract}</p>
                {/* 小屏双列网格；超窄屏改单列，避免“改派 / 查看分配”被按钮内宽裁掉 */}
                <div className="flex flex-wrap items-center gap-2 max-sm:grid max-sm:grid-cols-2 max-[359px]:grid-cols-1! max-sm:[&>button]:min-h-10">
                  <Button variant="outline" size="sm" onClick={() => setDetail(s)}>
                    <Eye className="h-4 w-4" /> 详情
                  </Button>
                  {s.status === 'pending' && (
                    <Button size="sm" onClick={() => setAssignTarget(s)}>
                      <UserPlus className="h-4 w-4" /> 分配互评成员
                    </Button>
                  )}
                  {(s.status === 'under_review' || s.status === 'resubmitted') && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAssignmentsTarget(s)}
                    >
                      <ClipboardList className="h-4 w-4" /> 改派 / 查看分配
                    </Button>
                  )}
                  {['pending', 'under_review', 'resubmitted'].includes(s.status) &&
                    isChief && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDecisionTarget(s)
                          setDecisionForm(EMPTY_DECISION)
                        }}
                        disabled={decisionMut.isPending || !canOpenDecision(s)}
                        title={decisionDisabledReason(s)}
                      >
                        <Gavel className="h-4 w-4" /> 做决定
                      </Button>
                    )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReportsTarget(s)}
                  >
                    <FileText className="h-4 w-4" /> 互评意见
                  </Button>
                  {[
                    'pending',
                    'under_review',
                    'resubmitted',
                    'major_revision',
                    'minor_revision',
                  ].includes(s.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAnonymizedTarget(s)}
                    >
                      <ShieldCheck className="h-4 w-4" /> 匿名稿
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data && (
        <Pagination
          page={data.meta.page}
          totalPages={data.meta.total_pages}
          onPageChange={(p) => updateSearch({ page: p })}
        />
      )}

      {/* 详情 Dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && closeDetail()}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
          </DialogHeader>
          {detail && <SubmissionDetailBody sub={detail} />}
        </DialogContent>
      </Dialog>

      {/* 分配互评成员 Dialog */}
      {assignTarget && (
        <AssignReviewerDialog
          submission={assignTarget}
          onClose={() => setAssignTarget(null)}
        />
      )}

      {/* 查看分配 Dialog */}
      {assignmentsTarget && (
        <AssignmentsDialog
          submission={assignmentsTarget}
          onClose={() => setAssignmentsTarget(null)}
        />
      )}

      {/* 匿名稿外链 Dialog */}
      {anonymizedTarget && (
        <AnonymizedFileDialog
          submission={anonymizedTarget}
          onClose={() => setAnonymizedTarget(null)}
        />
      )}

      {/* 做决定 Dialog */}
      <Dialog
        open={!!decisionTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDecisionTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              做决定 — {decisionTarget?.title}
              {isRevision && (
                <Badge className="ml-2 align-middle bg-violet-500/15 text-violet-700">
                  返修稿 v{decisionTarget?.latest_version}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {decisionTarget && (
              <RevisionEvidencePanel submission={decisionTarget} />
            )}
            {/* 互评报告概要：有报告时直接展示，帮助内容整理在同一个弹窗里完成决定 */}
            {decisionReportsQ.data && decisionReportsQ.data.length > 0 && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="text-xs font-medium text-muted-foreground">
                  互评意见概要（{decisionReportsQ.data.length} 份）
                </div>
                {decisionReportsQ.data.map((r) => (
                  <div key={r.id} className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">推荐：{recommendationLabel(r.recommendation)}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(r.submitted_at)}
                      </span>
                    </div>
                    {reportDimensionEntries(r.scores).length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap gap-2">
                          {reportDimensionEntries(r.scores).map(([k, v]) => (
                            <span key={k} className="rounded bg-muted px-2 py-0.5 text-xs">
                              {SCORE_LABELS[k] ?? k} {v.score ?? '未评'}/100
                            </span>
                          ))}
                        </div>
                        {typeof r.scores.score === 'number' && (
                          <p className="text-xs font-medium tabular-nums">
                            合计 {String(r.scores.score)} 分 · {String(r.scores.grade ?? '')} · 门槛封顶{' '}
                            {String(r.scores.cap ?? '无')}
                          </p>
                        )}
                        {reportDimensionEntries(r.scores).some(([, v]) => v.evidence) && (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer">查看逐条证据</summary>
                            <div className="mt-1 space-y-1">
                              {reportDimensionEntries(r.scores).map(([k, v]) => (
                                <p key={k}>
                                  <strong>{SCORE_LABELS[k] ?? k}</strong>：{v.reason || '无理由'} · 证据：{v.evidence || '无'}
                                  {v.suggestion ? <> · 修改意见：{v.suggestion}</> : null}
                                </p>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                    {r.comments_to_editor && (
                      <p className="whitespace-pre-wrap rounded bg-amber-500/10 p-2 text-xs text-amber-700">
                        内容整理保密意见：{r.comments_to_editor}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {decisionMatrixQ.data && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    已完成 {decisionMatrixQ.data.reports_completed} 份
                  </Badge>
                  <Badge variant="outline">
                    互评成员 {decisionMatrixQ.data.distinct_reviewers} 人
                  </Badge>
                  <Badge
                    className={
                      decisionMatrixQ.data.accept_count >= 1
                        ? 'bg-emerald-500/15 text-emerald-700'
                        : 'bg-amber-500/15 text-amber-700'
                    }
                  >
                    通过推荐 {decisionMatrixQ.data.accept_count} 份
                  </Badge>
                  {decisionMatrixQ.data.conflict && (
                    <Badge className="bg-amber-500/15 text-amber-700">
                      意见冲突
                    </Badge>
                  )}
                  {decisionMatrixQ.data.adjudicator_accepted && (
                    <Badge className="bg-emerald-500/15 text-emerald-700">
                      第三方已复核
                    </Badge>
                  )}
                </div>
                {decisionMatrixQ.data.accept_count < 1 && (
                  <p className="mt-2 text-xs text-amber-700">
                    {canDirectAccept
                      ? '本轮还没有新的通过推荐。作者已返修，主编核对修改后可勾选下方“返修稿直接录用”；否则继续等待互评或指定第三方复核。'
                      : '公开需要至少 1 名互评成员给出通过推荐。可继续等待意见，或确认作者已修回后再看；意见冲突时先指定第三方复核人。'}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="decision">决定</Label>
              <Select
                value={decisionForm.decision}
                onValueChange={(v) =>
                  setDecisionForm((prev) => ({
                    ...prev,
                    decision: v as EditorDecision,
                    // 离开“通过”时清掉直接录用与破例开关，避免状态串到别的决定
                    accept_after_revision: false,
                    force_accept_d_grade: false,
                  }))
                }
              >
                <SelectTrigger id="decision" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECISION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                      {o.hint && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({o.hint})
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {decisionForm.decision === 'accept' && canDirectAccept && (
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-violet-300 bg-violet-500/5 p-3 dark:border-violet-800">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600"
                  checked={decisionForm.accept_after_revision}
                  onChange={(e) =>
                    setDecisionForm((prev) => ({
                      ...prev,
                      accept_after_revision: e.target.checked,
                    }))
                  }
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    返修稿直接录用（v{decisionTarget?.latest_version}）
                  </span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    作者已按上一轮意见修回。勾选后跳过“本轮必须有通过意见”的互评闸门，直接进入录用；决定会写入作者可见备注和审计日志。首次投稿不能用这一项。
                  </span>
                </span>
              </label>
            )}
            {decisionForm.decision === 'accept' && (
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={decisionForm.force_accept_d_grade}
                  onChange={(e) =>
                    setDecisionForm((prev) => ({
                      ...prev,
                      force_accept_d_grade: e.target.checked,
                    }))
                  }
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    如质量分低于 40，仍破例录用
                  </span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    正常规则下低于 40 分不能通过。勾选后本次录用会按破例处理，必须在下方备注里写明理由，否则后端会拒绝。
                  </span>
                </span>
              </label>
            )}
            <div className="space-y-2">
              <Label htmlFor="editor_note">内容整理备注（作者可见）</Label>
              <Textarea
                id="editor_note"
                value={decisionForm.editor_note}
                onChange={(e) =>
                  setDecisionForm((prev) => ({
                    ...prev,
                    editor_note: e.target.value,
                  }))
                }
                placeholder="说明决定原因，作者将在发布详情中看到"
                rows={4}
              />
            </div>
            {decisionMatrixQ.data?.conflict && !decisionForm.accept_after_revision && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                <Label htmlFor="arbitration_note" className="text-amber-800 dark:text-amber-200">
                  互评意见冲突，需填写复核理由（必填）
                </Label>
                <Textarea
                  id="arbitration_note"
                  value={decisionForm.arbitration_note}
                  onChange={(e) =>
                    setDecisionForm((prev) => ({
                      ...prev,
                      arbitration_note: e.target.value,
                    }))
                  }
                  placeholder="说明为何采纳某份意见、驳回另一份"
                  rows={3}
                />
              </div>
            )}
          </div>

          {/* D 级处置：不直接不通过，而是退回作者按逐条要求修改。
              作者改完并显式重交后才回到互评，不提前打扰互评成员。 */}
          <div className="space-y-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-destructive">退回作者修改（D 级处置）</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReworkOpen((v) => !v)}
                type="button"
              >
                {reworkOpen ? '收起' : '发起退回'}
              </Button>
            </div>
            {reworkOpen && (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  {`作品会进入「待修改」，作者会收到逐条修改要求，并可在「我的作品」里修改、上传修订稿、显式重新提交。重交后才重新进入互评；请至少填 3 条具体问题。`}
                </p>
                {decisionTarget?.quality_score != null && decisionTarget.quality_score < 40 && (
                  <p className="rounded bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                    当前评分 {decisionTarget?.quality_score ?? '—'} 分（不合格，低于 40），
                    按规范不能直接通过。
                  </p>
                )}
                <Textarea
                  placeholder="每行一条修改要求，至少 3 行（例如：补充样本量的说明）"
                  value={reworkRequirements}
                  onChange={(e) => setReworkRequirements(e.target.value)}
                  rows={4}
                  className="text-xs"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={reworkMut.isPending}
                  onClick={async () => {
                    const reqs = reworkRequirements
                      .split(String.fromCharCode(10))
                      .map((x) => x.trim())
                      .filter(Boolean)
                    if (reqs.length < 3) {
                      toast.error('请至少填写 3 条具体修改要求')
                      return
                    }
                    if (!decisionTarget) return
                    try {
                      await reworkMut.mutateAsync({ id: decisionTarget.id, requirements: reqs })
                      toast.success('已退回作者修改：作者已收到逐条要求，修改后可重新提交')
                      setReworkOpen(false)
                      setReworkRequirements('')
                      setDecisionTarget(null)
                    } catch (err) {
                      toast.error(extractError(err, '打回失败'))
                    }
                  }}
                >
                  {reworkMut.isPending ? '提交中…' : '确认退回作者修改'}
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionTarget(null)}>
              取消
            </Button>
            <Button onClick={onConfirmDecision} disabled={decisionMut.isPending}>
              {decisionMut.isPending ? '处理中…' : '确认决定'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 互评报告 Dialog */}
      {reportsTarget && (
        <ReportsDialog
          submission={reportsTarget}
          onClose={() => setReportsTarget(null)}
        />
      )}

      {/* 不通过二次确认：终态操作，先想清楚再执行 */}
      <ConfirmDialog
        open={rejectConfirm}
        title="确认不通过"
        description="不通过后该投稿将进入「已不通过」状态，作者不能继续修改或重新投稿。确定要不通过吗？"
        confirmText="确认不通过"
        destructive
        onConfirm={() => {
          setRejectConfirm(false)
          if (decisionTarget) void doDecision(decisionTarget)
        }}
        onOpenChange={(o) => !o && setRejectConfirm(false)}
      />
    </div>
  )
}

// 详情面板：抽出为组件避免主组件过于臃肿
function SubmissionDetailBody({ sub }: { sub: SubmissionResponse }) {
  // 版本历史：内容整理需要知道作品被重新发布过几次、每次作者说明了什么
  const versionsQ = useSubmissionVersions(sub.id)
  const putAuthors = usePutAuthors()
  // 作者内容整理：从 sub.authors（字符串数组）初始化
  const [authors, setAuthors] = useState<AuthorEditInput[]>(() =>
    sub.authors.map((name, i) => ({
      name,
      affiliation: sub.author_affiliations?.[i] ?? '',
      email: '',
      roles: i === 0 ? ['first'] : [],
      order: i + 1,
    })),
  )
  const [dirty, setDirty] = useState(false)

  const onSaveAuthors = async () => {
    if (authors.length === 0) {
      toast.error('至少需要 1 位作者')
      return
    }
    if (!authors.some((a) => a.roles.includes('first'))) {
      toast.error('必须指定 1 位第一作者')
      return
    }
    try {
      await putAuthors.mutateAsync({ path: 'submission', id: sub.id, authors })
      toast.success('作者列表已保存')
      setDirty(false)
    } catch (err) {
      toast.error(extractError(err, '保存作者失败'))
    }
  }

  return (
    <div className="min-w-0 space-y-3 break-words text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{typeLabel(sub.type)}</Badge>
        <span className="text-muted-foreground">{sub.discipline}</span>
        <span className="text-muted-foreground">{sub.year}</span>
        {sub.subdiscipline && (
          <span className="text-muted-foreground">{sub.subdiscipline}</span>
        )}
        {(sub.author_affiliations ?? []).length > 0 && (
          <span className="text-xs text-muted-foreground">
            署名单位：{(sub.author_affiliations ?? []).join('；')}
          </span>
        )}
      </div>

      {/* 作者内容整理面板：增删/排序/第一/联系 */}
      <div className="rounded-md border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium">署名（发布前可内容整理）</span>
          <div className="flex items-center gap-2">
            {dirty && <Badge variant="outline" className="text-amber-700">未保存</Badge>}
            <Button size="sm" variant="outline" onClick={onSaveAuthors} disabled={putAuthors.isPending}>
              <Save className="h-3.5 w-4" /> 保存
            </Button>
          </div>
        </div>
        <AuthorEditor
          value={authors}
          onChange={(next) => {
            setAuthors(next)
            setDirty(true)
          }}
        />
      </div>

      {sub.venue && (
        <div>
          <span className="text-muted-foreground">来源说明：</span>
          {sub.venue}
        </div>
      )}
      {sub.keywords && sub.keywords.length > 0 && (
        <div>
          <span className="text-muted-foreground">话题：</span>
          {sub.keywords.join(', ')}
        </div>
      )}
      {sub.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {sub.tags.map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
        </div>
      )}
      <div>
        <span className="text-muted-foreground">开头</span>
        <p className="mt-1 whitespace-pre-wrap">{normalizeAbstract(sub.abstract)}</p>
      </div>
      <div>
        <span className="text-muted-foreground">预览</span>
        <p className="mt-1 whitespace-pre-wrap">{sub.preview}</p>
      </div>
      {sub.download_url && (
        <div className="break-all">
          <span className="text-muted-foreground">下载：</span>
          {sub.download_url}
        </div>
      )}
      {sub.external_url && (
        <div className="break-all">
          <span className="text-muted-foreground">外部链接：</span>
          {sub.external_url}
        </div>
      )}
      {sub.file_path && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">作品文件：</span>
          <span className="break-all text-primary">{sub.file_path}</span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
            onClick={() => void downloadSubmissionFile(sub.id, 'docx')}
          >
            <Download className="h-3.5 w-3.5" />
            Word
          </button>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
            onClick={() => void downloadSubmissionFile(sub.id, 'pdf')}
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </button>
        </div>
      )}
      {versionsQ.data && versionsQ.data.length > 0 && (
        <div className="rounded-md border p-3">
          <div className="mb-2 font-medium">版本历史</div>
          <ol className="space-y-1.5">
            {versionsQ.data.map((v) => (
              <li key={v.id} className="flex gap-2">
                <Badge variant="outline" className="shrink-0">
                  v{v.version}
                </Badge>
                <div className="min-w-0">
                  <span className="text-xs text-muted-foreground">
                    {v.version === 1 ? '初次提交' : '重新提交'} ·{' '}
                    {formatDateTime(v.created_at)}
                  </span>
                  {v.note && (
                    <p className="mt-0.5 whitespace-pre-wrap">
                      修改说明:{v.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        提交于 {formatDateTime(sub.submitted_at)}
      </div>
    </div>
  )
}

// 分配互评成员对话框：列出本租户所有用户供内容整理挑选
function AssignReviewerDialog({
  submission,
  onClose,
}: {
  submission: SubmissionResponse
  onClose: () => void
}) {
  // 专供内容整理的候选端点：只返回持 reviewer 角色且启用的账号，非 admin 的
  // editor 也能用（此前走 /admin/users 会 403，下拉永远是空的）。
  const disciplines = useDisciplines()
  const disciplineNames = new Map(
    (disciplines.data ?? []).map((item) => [item.slug, item.name]),
  )
  const [onlySameDiscipline, setOnlySameDiscipline] = useState(false)
  const submissionDisciplineSlug = (disciplines.data ?? []).find(
    (item) => item.name === submission.discipline,
  )?.slug
  const { data: candidateData, isLoading } = useReviewerCandidates(
    REVIEWER_CANDIDATE_LIMIT,
    submission.id,
    onlySameDiscipline ? submissionDisciplineSlug : undefined,
  )
  const candidates = candidateData ?? []
  const truncated = candidates.length >= REVIEWER_CANDIDATE_LIMIT
  const assignMut = useAssignReviewersBulk()
  const [selected, setSelected] = useState<number[]>([])
  const [dueDays, setDueDays] = useState('14')
  const [isExternal, setIsExternal] = useState(false)
  const [externalAffiliation, setExternalAffiliation] = useState('')
  const [invitingId, setInvitingId] = useState<number | null>(null)

  const toggle = (id: number) => {
    const candidate = candidates.find((item) => item.id === id)
    if (candidate?.conflict) {
      toast.error('该互评成员已声明与作者存在利益冲突，不能指派')
      return
    }
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id],
    )
  }

  const onQuickInvite = async (candidate: ReviewerCandidate) => {
    if (candidate.conflict) {
      toast.error('该互评成员与作者存在可核验的利益冲突，请更换人选')
      return
    }
    setInvitingId(candidate.id)
    try {
      const res = await assignMut.mutateAsync({
        id: submission.id,
        body: {
          reviewer_ids: [candidate.id],
          due_days: 14,
          is_external: false,
        },
      })
      toast.success(`已发送邀请，默认 14 天截止（指派 ${res.assigned} 名）`)
      onClose()
    } catch (err) {
      toast.error(extractError(err, '邀请失败'))
    } finally {
      setInvitingId(null)
    }
  }

  const onConfirm = async () => {
    if (selected.length === 0) {
      toast.error('请至少选择一名互评成员（最多 3 名）')
      return
    }
    try {
      const res = await assignMut.mutateAsync({
        id: submission.id,
        body: {
          reviewer_ids: selected,
          due_days: Math.max(1, Math.min(90, Number(dueDays) || 14)),
          is_external: isExternal,
          external_affiliation: isExternal ? externalAffiliation.trim() || undefined : undefined,
        },
      })
      toast.success(`已指派 ${res.assigned} 名互评成员`)
      onClose()
    } catch (err) {
      toast.error(extractError(err, '指派失败'))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>指派互评成员 — {submission.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            可一次多选（最多 3 名，占 slot 1/2/3）；重复邀请同一互评成员会自动跳过。
          </p>
          {submissionDisciplineSlug && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={onlySameDiscipline}
                onChange={(e) => setOnlySameDiscipline(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              只看自选「{submission.discipline}」方向的互评成员
            </label>
          )}
          <div className="max-h-[40dvh] space-y-1 overflow-y-auto">
            {isLoading ? (
              <Loading />
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {onlySameDiscipline
                  ? '没有自选该方向的互评成员；取消筛选可查看全部候选。'
                  : '没有可指派的互评成员：请先在「用户管理」里给用户授予互评成员角色。'}
              </p>
            ) : (
              candidates.map((u) => {
                const checked = selected.includes(u.id)
                return (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={Boolean(u.conflict)}
                      onChange={() => toggle(u.id)}
                      className="h-4 w-4"
                    />
                    <span className="font-medium">{u.username}</span>
                    <span className="text-xs text-muted-foreground">{u.email}</span>
                    {typeof u.score === 'number' && u.score > 0 ? (
                      <Badge variant="outline" className="text-[10px]">
                        匹配 {u.score}
                      </Badge>
                    ) : null}
                    {(u.reviewer_disciplines ?? []).slice(0, 2).map((slug) => (
                      <Badge
                        key={slug}
                        variant="outline"
                        className="border-primary/40 text-[10px] text-primary"
                      >
                        {disciplineNames.get(slug) ?? slug}
                      </Badge>
                    ))}
                    {(u.reviewer_tags ?? []).slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                    {u.conflict ? (
                      <Badge variant="destructive" className="text-[10px]" title={(u.conflict_reasons ?? []).join('、')}>
                        利益冲突
                      </Badge>
                    ) : !u.coi_declared ? (
                      <Badge variant="outline" className="text-[10px]">
                        未声明
                      </Badge>
                    ) : null}
                    {!u.conflict && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="ml-auto h-6 px-2 text-[10px]"
                        disabled={assignMut.isPending || invitingId === u.id}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          void onQuickInvite(u)
                        }}
                      >
                        {invitingId === u.id ? '邀请中…' : '一键邀请 · 14 天'}
                      </Button>
                    )}
                    {selected.includes(u.id) && (
                      <span className="ml-auto text-xs text-primary">已选</span>
                    )}
                  </label>
                )
              })
            )}
          </div>
          {truncated && (
            <p className="text-xs text-muted-foreground">
              当前筛选下最多返回 {REVIEWER_CANDIDATE_LIMIT} 位互评成员；目标不在其中时请用
              「用户管理」确认其角色与自选方向。
            </p>
          )}
          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={isExternal}
                onChange={(e) => setIsExternal(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="font-medium">外部互评成员</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  由总协调/内容整理指定，标记会写入互评矩阵与审计；互评成员仍需用站内账号登录。
                </span>
              </span>
            </label>
            {isExternal && (
              <Input
                placeholder="外部单位 / 地区，例如：中山大学（广东）"
                value={externalAffiliation}
                onChange={(e) => setExternalAffiliation(e.target.value)}
                maxLength={120}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="due_days">互评截止天数（1–90）</Label>
            <Input
              id="due_days"
              type="number"
              min={1}
              max={90}
              value={dueDays}
              onChange={(e) => setDueDays(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={assignMut.isPending}>
            {assignMut.isPending ? '处理中…' : `确认指派（${selected.length} 人）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 查看分配列表对话框
function AssignmentsDialog({
  submission,
  onClose,
}: {
  submission: SubmissionResponse
  onClose: () => void
}) {
  const { data, isLoading, isError, refetch } = useSubmissionAssignments(
    submission.id,
  )
  const matrixQ = useReviewMatrix(submission.id)
  const [adjOpen, setAdjOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const cancelMut = useCancelAssignment()

  const onCancel = async (assignmentId: number) => {
    try {
      await cancelMut.mutateAsync({
        submissionId: submission.id,
        assignmentId,
      })
      toast.success('已撤销分配')
    } catch (err) {
      toast.error(extractError(err, '撤销失败'))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>互评分配 — {submission.title}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message="互评分配加载失败，可重试。" onRetry={() => refetch()} />
        ) : !data || data.data.length === 0 ? (
          <EmptyState title="暂无互评分配" description="回到作品卡片，先分配互评成员。" />
        ) : (
          <div className="space-y-3">
            {matrixQ.data && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    完成互评 {matrixQ.data.reports_completed} 份
                  </Badge>
                  <Badge variant="outline">
                    互评成员 {matrixQ.data.distinct_reviewers} 人
                  </Badge>
                  <Badge
                    className={
                      matrixQ.data.accept_count >= 1
                        ? 'bg-emerald-500/15 text-emerald-700'
                        : 'bg-amber-500/15 text-amber-700'
                    }
                  >
                    通过推荐 {matrixQ.data.accept_count} 份
                  </Badge>
                  {matrixQ.data.conflict && (
                    <Badge className="bg-amber-500/15 text-amber-700">意见冲突</Badge>
                  )}
                  {matrixQ.data.adjudicator_assigned && (
                    <Badge variant="outline">
                      第三方复核人
                    </Badge>
                  )}
                </div>
                {(matrixQ.data.need_adjudication || matrixQ.data.adjudicator_assigned) && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-amber-700">
                      {matrixQ.data.need_adjudication
                        ? '互评意见冲突，需要第三方复核人给出独立意见后才能通过。'
                        : '已指定第三方复核人，等待其提交意见。'}
                    </p>
                    {matrixQ.data.need_adjudication && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAdjOpen(true)}
                      >
                        <Gavel className="mr-1 h-4 w-4" /> 指定第三方复核人
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="space-y-2">
            {data.data.map((a: AssignmentResponse) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm"
              >
                <span className="font-medium">
                  {a.reviewer_username ?? `#${a.reviewer_id}`}
                </span>
                {assignmentStatusBadge(a.status)}
                {reminderBadge(a.reminder_count, a.last_reminded_at)}
                <span className="text-xs text-muted-foreground">
                  邀于 {formatDateTime(a.invited_at)}
                </span>
                {a.due_date && (
                  <span className="text-xs text-muted-foreground">
                    · 截止 {formatDateTime(a.due_date)}
                  </span>
                )}
                {a.completed_at && (
                  <span className="text-xs text-muted-foreground">
                    · 完成 {formatDateTime(a.completed_at)}
                  </span>
                )}
                <div className="ml-auto">
                  {['pending', 'accepted'].includes(a.status) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onCancel(a.id)}
                      disabled={cancelMut.isPending}
                    >
                      撤销
                    </Button>
                  )}
                </div>
              </div>
            ))}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setAssignOpen(true)}>
            <UserPlus className="mr-1 h-4 w-4" /> 追加 / 改派互评成员
          </Button>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
      {assignOpen && (
        <AssignReviewerDialog
          submission={submission}
          onClose={() => setAssignOpen(false)}
        />
      )}
      {adjOpen && matrixQ.data && (
        <AdjudicateDialog
          submission={submission}
          matrix={matrixQ.data}
          onClose={() => setAdjOpen(false)}
        />
      )}
    </Dialog>
  )
}

// 第三方复核人：只在意见冲突/需要独立复核时由总协调或内容整理指定。
function AdjudicateDialog({
  submission,
  matrix,
  onClose,
}: {
  submission: SubmissionResponse
  matrix: ReviewMatrixResponse
  onClose: () => void
}) {
  const { data: candidateData, isLoading } = useReviewerCandidates(REVIEWER_CANDIDATE_LIMIT, submission.id)
  const candidates = (candidateData ?? []).filter(
    (u) => !matrix.assignments.some((a) => a.reviewer_id === u.id),
  )
  const mut = useAssignAdjudicator()
  const [selected, setSelected] = useState<number | null>(null)
  const [dueDays, setDueDays] = useState('14')
  const [reason, setReason] = useState('')

  const onConfirm = async () => {
    if (!selected) {
      toast.error('请选择一位第三方复核人')
      return
    }
    try {
      await mut.mutateAsync({
        id: submission.id,
        reviewer_id: selected,
        due_days: Math.max(1, Math.min(90, Number(dueDays) || 14)),
        reason: reason.trim() || undefined,
      })
      toast.success('已指定第三方复核人，并已发送站内通知')
      onClose()
    } catch (err) {
      toast.error(extractError(err, '指定复核人失败'))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>指定第三方复核人 — {submission.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            当前已有 {matrix.distinct_reviewers} 位互评成员提交意见，通过推荐 {matrix.accept_count} 份。
            复核人不能是本篇已参与互评的成员，也不能是作者。
          </p>
          <div className="max-h-[35dvh] space-y-1 overflow-y-auto">
            {isLoading ? (
              <Loading />
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                没有可用的第三方复核人：请确认互评成员账号已授予 reviewer 角色，且未参与本稿。
              </p>
            ) : (
              candidates.map((u) => (
                <label
                  key={u.id}
                  className="flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <input
                    type="radio"
                    name="adjudicator"
                    checked={selected === u.id}
                    onChange={() => setSelected(u.id)}
                    className="h-4 w-4"
                  />
                  <span className="font-medium">{u.username}</span>
                  <span className="text-xs text-muted-foreground">{u.email}</span>
                  {typeof u.score === "number" && u.score > 0 ? (
                    <Badge variant="outline" className="text-[10px]">匹配 {u.score}</Badge>
                  ) : null}
                </label>
              ))
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="adj_due">复核截止天数（1–90）</Label>
            <Input
              id="adj_due"
              type="number"
              min={1}
              max={90}
              value={dueDays}
              onChange={(e) => setDueDays(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adj_reason">复核说明（发给复核人）</Label>
            <Textarea
              id="adj_reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="说明分歧点与需要独立判断的问题"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={onConfirm} disabled={mut.isPending}>
            {mut.isPending ? '处理中…' : '确认指定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 互评报告对话框：内容整理可见完整报告（含 comments_to_editor）
function ReportsDialog({
  submission,
  onClose,
}: {
  submission: SubmissionResponse
  onClose: () => void
}) {
  const { data, isLoading, isError, refetch } = useSubmissionReports(
    submission.id,
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>互评意见 — {submission.title}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <ErrorState message="互评意见加载失败，可重试。" onRetry={() => refetch()} />
        ) : !data || data.length === 0 ? (
          <EmptyState title="暂无已完成的互评意见" />
        ) : (
          <div className="space-y-4">
            {data.map((r: ReviewReportResponse) => (
              <div key={r.id} className="rounded border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-emerald-500/15 text-emerald-700">
                    已完成
                  </Badge>
                  <Badge variant="outline">推荐：{recommendationLabel(r.recommendation)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(r.submitted_at)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {reportDimensionEntries(r.scores).map(([k, v]) => (
                    <div key={k} className="rounded bg-muted p-1 text-center text-xs">
                      <div className="font-medium">{SCORE_LABELS[k] ?? k}</div>
                      <div className="text-muted-foreground">{v.score ?? '未评'}/100</div>
                    </div>
                  ))}
                </div>
                {reportDimensionEntries(r.scores).some(([, v]) => v.evidence) && (
                  <div className="mt-2 space-y-1 rounded border bg-muted/20 p-2 text-xs">
                    {reportDimensionEntries(r.scores).map(([k, v]) => (
                      <p key={k}>
                        <strong>{SCORE_LABELS[k] ?? k}</strong>：{v.reason || '无理由'} · 证据：{v.evidence || '无'}
                        {v.suggestion ? <> · 修改意见：{v.suggestion}</> : null}
                      </p>
                    ))}
                  </div>
                )}
                {r.comments_to_author && (
                  <div className="mt-2">
                    <div className="text-xs text-muted-foreground">
                      给作者的意见
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">
                      {r.comments_to_author}
                    </p>
                  </div>
                )}
                {r.comments_to_editor && (
                  <div className="mt-2 rounded bg-amber-500/10 p-2">
                    <div className="text-xs text-amber-700">
                      给内容整理的保密意见
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">
                      {r.comments_to_editor}
                    </p>
                  </div>
                )}
                {r.attachments && r.attachments.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs text-muted-foreground">互评附件</div>
                    <ReviewAttachmentLinks
                      reportId={r.id}
                      attachments={r.attachments}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AnonymizedFileDialog({
  submission,
  onClose,
}: {
  submission: SubmissionResponse
  onClose: () => void
}) {
  const setAnon = useSetAnonymizedFile()
  const [url, setUrl] = useState(submission.anonymized_file_url ?? '')

  const isHttpUrl = (v: string) => /^https?:\/\/\S+/i.test(v.trim())

  const onSave = async () => {
    if (!isHttpUrl(url)) {
      toast.error('请填写 http(s) 开头的匿名稿链接')
      return
    }
    try {
      await setAnon.mutateAsync({ id: submission.id, url: url.trim() })
      toast.success('匿名稿链接已保存')
      onClose()
    } catch (err) {
      toast.error(extractError(err, '保存失败'))
    }
  }

  const onClear = async () => {
    try {
      await setAnon.mutateAsync({ id: submission.id, url: null })
      toast.success('匿名稿链接已清除')
      onClose()
    } catch (err) {
      toast.error(extractError(err, '清除失败'))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>匿名稿 — {submission.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            匿名互评下互评成员只能访问这里填写的匿名稿外链；作者可控的
            download_url / external_url 不会流向互评成员。服务端不具备剥离 PDF
            元数据的能力，请确认上传的匿名稿本身不含作者姓名与单位。
          </p>
          <div className="space-y-1">
            <Label htmlFor="anonymized-file-url">匿名稿链接（http/https）</Label>
            <Input
              id="anonymized-file-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.org/anonymized-manuscript.pdf"
            />
          </div>
        </div>
        <DialogFooter>
          {submission.anonymized_file_url && (
            <Button variant="ghost" onClick={onClear} disabled={setAnon.isPending}>
              清除
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onSave} disabled={setAnon.isPending || !isHttpUrl(url)}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
