import { useEffect, useRef, useState } from 'react'
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouterState,
  useSearch,
} from '@tanstack/react-router'
import {
  Download,
  ExternalLink,
  FileText,
  History,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { reviewDimensionEntries } from '@/lib/review-dimensions'
import { getAuthState } from '@/lib/auth'
import {
  downloadSubmissionFile,
  downloadSubmissionVersion,
  useDeleteSubmission,
  useMySubmissions,
  useResubmitSubmission,
  useSubmission,
  useSubmissionReports,
  useSubmissionVersions,
  useSaveAuthorResponse,
  useUploadSubmissionFile,
} from '@/hooks/api/use-modules'
import type {
  IngestResource,
  ReviewReportResponse,
  SubmissionResponse,
  SubmissionStatus,
} from '@/lib/types'
import { displayTypeLabel } from '@/lib/resource-labels'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useCapabilities } from '@/hooks/use-capabilities'
import { cn, extractError } from '@/lib/utils'
import { normalizeAbstract } from '@/lib/abstract'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import WorkflowTimeline from '@/components/WorkflowTimeline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// 注册 router state 的 preset 字段：ingest 页通过 navigate state 传预填数据，
// 借助 HistoryState 接口的声明合并让两端都类型安全
declare module '@tanstack/history' {
  interface HistoryState {
    preset?: IngestResource
  }
}

export const Route = createFileRoute('/submissions/')({
  beforeLoad: () => {
    if (!getAuthState().isAuthenticated) throw redirect({ to: '/login', search: { redirect: '/submissions' } })
  },
  component: SubmissionsPage,
})

interface SubmissionSearch {
  status?: SubmissionStatus | 'all'
  page?: number
  /** 通知深链：直接打开某条作品，不用先翻列表。 */
  submission?: number
}

const STATUS_TABS: { value: SubmissionStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待回应' },
  { value: 'under_review', label: '互评中' },
  { value: 'major_revision', label: '待大改' },
  { value: 'minor_revision', label: '待小改' },
  { value: 'rework_requested', label: '待修改' },
  { value: 'accepted', label: '已公开' },
  { value: 'rejected', label: '已不通过' },
]

// 作者可编辑内容的状态（与后端 update_submission 的状态门一致）
const EDITABLE_STATUSES = ['pending', 'major_revision', 'minor_revision', 'rework_requested']

function statusBadge(status: SubmissionStatus) {
  switch (status) {
    case 'pending':
      return <Badge variant="secondary">待回应</Badge>
    case 'under_review':
      return <Badge className="bg-primary/15 text-primary">互评中</Badge>
    case 'major_revision':
      return <Badge className="bg-amber-500/15 text-amber-700">待大改</Badge>
    case 'minor_revision':
      return <Badge className="bg-yellow-500/15 text-yellow-700">待小改</Badge>
    case 'rework_requested':
      return <Badge className="bg-sky-500/15 text-sky-700">待修改</Badge>
    case 'accepted':
    case 'approved':
      return <Badge className="bg-emerald-500/15 text-emerald-700">已公开</Badge>
    case 'rejected':
      return <Badge variant="destructive">已不通过</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

// 状态语义提示：第一次发布作品的作者最焦虑的是"这个状态是什么意思、我该做什么"。
// 一句话讲清现状与下一步，展示在详情面板状态徽章下方。
const STATUS_HINTS: Record<string, string> = {
  pending: '内容整理会先做基础检查，通常 3–7 天更新；不用重复发布。',
  under_review: '互评进行中：互评成员正在看你的作品，意见会出现在详情里。',
  major_revision: '需要大幅修改：按意见改完后，在详情逐条回应，再更新一版。',
  minor_revision: '需要小幅修改：调整后更新一版，通常不用再走一轮互评。',
  rework_requested: '作品已退回修改：点「修改作品」按意见改完并保存，再点「重新提交修改稿」。重交后才会重新进入互评。',
  resubmitted: '修改版已发布，等待内容整理复核；有未尽事项可在详情补充。',
  accepted: '已公开。作品进入内容库，登录后可读。',
  rejected: '本次已不通过。可以按反馈修改后重新发布。',
}

function statusHint(status: string): string {
  return STATUS_HINTS[status] ?? ''
}

function SubmissionsPage() {
  const navigate = useNavigate()
  // 上传约束来自服务端（/capabilities），前端不再维护第二份规则。
  const caps = useCapabilities()
  const uploadMaxMb = Math.round((caps.data?.upload_max_bytes ?? 50 * 1024 * 1024) / 1024 / 1024)
  const maxUploadBytes = caps.data?.upload_max_bytes ?? 50 * 1024 * 1024
  const acceptAttr = (caps.data?.upload_extensions ?? ['.docx', '.doc', '.pdf', '.txt', '.zip']).join(',')
  const search = useSearch({ strict: false }) as SubmissionSearch
  const statusTab = (search.status ?? 'all') as SubmissionStatus | 'all'
  const page = search.page ?? 1
  const status = statusTab === 'all' ? undefined : statusTab

  const isMobile = useIsMobile()
  const { data, isLoading, isError, refetch } = useMySubmissions(status, page, 20)
  const linkedSubmissionId = Number(search.submission ?? 0)
  const linkedSubmission = useSubmission(linkedSubmissionId)
  const deleteMut = useDeleteSubmission()
  const uploadMut = useUploadSubmissionFile()
  const resubmitMut = useResubmitSubmission()
  const saveResponseMut = useSaveAuthorResponse()

  const [detail, setDetail] = useState<SubmissionResponse | null>(null)
  const [authorResponseDraft, setAuthorResponseDraft] = useState('')
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [resubmitOpen, setResubmitOpen] = useState(false)
  const [resubmitNote, setResubmitNote] = useState('')
  // 仅在 detail 对话框打开时拉取互评意见 / 版本历史（hook 通过 enabled 守卫）；
  // 必须放在 detail useState 之后，否则 TS2448/2454 报"使用先于声明"。
  const reportsQ = useSubmissionReports(detail?.id ?? 0)
  const versionsQ = useSubmissionVersions(detail?.id ?? 0, detail !== null)

  useEffect(() => {
    setAuthorResponseDraft(detail?.author_response ?? '')
  }, [detail?.id, detail?.author_response])

  const linkedDetailApplied = useRef(0)
  useEffect(() => {
    if (!linkedSubmissionId || linkedDetailApplied.current === linkedSubmissionId) return
    if (!linkedSubmission.data) return
    linkedDetailApplied.current = linkedSubmissionId
    setDetail(linkedSubmission.data)
  }, [linkedSubmissionId, linkedSubmission.data])

  const onSaveAuthorResponse = async () => {
    if (!detail) return
    try {
      const updated = await saveResponseMut.mutateAsync({
        id: detail.id,
        response: authorResponseDraft,
      })
      setDetail(updated)
      toast.success('已保存逐条回复，内容整理复核时可看到')
    } catch (err) {
      toast.error(extractError(err, '回复保存失败'))
    }
  }

  const onUploadFile = async (file: File) => {
    if (!detail) return
    try {
      const updated = await uploadMut.mutateAsync({ id: detail.id, file })
      setDetail(updated)
      toast.success('文件已上传')
      // 结构报告：作者上传后立刻知道"离《作品规范》还差什么"。
      const report = updated.format_report
      if (report && !report.ok) {
        const missing = report.items.filter((i) => !i.ok).map((i) => i.label).join('、')
        toast.warning(`已上传，但结构检查提示缺少：${missing}`, {
          description: '点击作品详情查看各项修正建议；不影响内容整理通过。',
          duration: 8000,
        })
      } else if (report?.ok) {
        toast.success('结构检查通过：开头、话题、章节与出处说明齐全')
      }
    } catch (err) {
      toast.error(extractError(err, '上传失败'))
    }
  }

  // 待大改/待小改状态下作者发布新版本，触发 submission → resubmitted → under_review。
  // 新版本会把当前作品内容快照存档，note 随版本推送给内容整理。
  const onResubmit = async () => {
    if (!detail) return
    try {
      const updated = await resubmitMut.mutateAsync({
        id: detail.id,
        note: resubmitNote.trim() || undefined,
      })
      setDetail(updated)
      setResubmitOpen(false)
      setResubmitNote('')
      toast.success(
        detail.status === 'rework_requested'
          ? '修改稿已重新提交，等待内容整理复核'
          : '已更新版本，等待内容整理',
      )
    } catch (err) {
      toast.error(extractError(err, '更新版本失败'))
    }
  }

  // ingest 页 "提交到目录" 通过 router state 传预填数据：
  // 直接转交给四步向导页（由向导消费 preset 并清空 state）。
  const preset = useRouterState({
    select: (s) => s.location.state?.preset,
  })
  const presetHandled = useRef(false)
  useEffect(() => {
    if (!preset || presetHandled.current) return
    presetHandled.current = true
    void navigate({ to: '/submissions/new', state: { preset }, replace: true })
  }, [preset, navigate])

  const updateSearch = (patch: Partial<SubmissionSearch>) => {
    void navigate({
      to: '/submissions',
      search: { ...search, ...patch },
      replace: true,
    })
  }

  const closeDetail = () => {
    setDetail(null)
    linkedDetailApplied.current = 0
    if (search.submission) updateSearch({ submission: undefined })
  }

  const onConfirmDelete = async () => {
    if (deleteId === null) return
    const target = deleteId
    setDeleteId(null)
    try {
      await deleteMut.mutateAsync(target)
      toast.success('已撤回')
    } catch (err) {
      toast.error(extractError(err, '撤回失败'))
    }
  }

  return (
    <div>
      <PageHeader
        title="我的作品"
        description="查看你发布的作品与进度；长文在这里发布，短帖直接去主题论坛。"
        actions={
          <>
            <Button
              onClick={() => {
                void navigate({ to: '/submissions/new' })
              }}
            >
              <Plus className="h-4 w-4" />
              写新的一篇
            </Button>
          </>
        }
      />

      <div
        role="tablist"
        aria-label="按作品状态筛选"
        className="mb-5 flex flex-wrap items-center gap-1 border-b pb-2"
      >
        {STATUS_TABS.map((t) => {
          const active = statusTab === t.value
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => updateSearch({ status: t.value, page: 1 })}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                active
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="作品列表加载失败，可重试。" onRetry={() => refetch()} />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          title="还没有作品"
          description="从这里开始写一篇；草稿会自动保存在本机和账号里，随时回来接着写。"
          action={
            <Button asChild size="sm">
              <Link to="/submissions/new">
                <Plus className="mr-1 h-4 w-4" />
                写新的一篇
              </Link>
            </Button>
          }
        />
      ) : (
        isMobile ? (
          <div className="mt-4 space-y-3">
            {data.data.map((s) => (
              <div
                key={s.id}
                onClick={() => setDetail(s)}
                className="cursor-pointer rounded-lg border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-2 text-sm font-medium">{s.title}</p>
                  {statusBadge(s.status)}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {displayTypeLabel(s.type, s.content_category, undefined, s.track)} · {s.discipline}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <time className="text-xs text-muted-foreground">
                    {new Date(s.submitted_at).toLocaleDateString()}
                  </time>
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {s.status === 'pending' && (
                      <Button variant="ghost" size="sm" onClick={() => setDeleteId(s.id)}>
                        <Trash2 className="h-4 w-4" />
                        撤回
                      </Button>
                    )}
                    {s.resource_id != null && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          to="/catalog/$resourceId"
                          params={{ resourceId: String(s.resource_id) }}
                        >
                          <ExternalLink className="h-4 w-4" />
                          查看作品
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
        <Card className="mt-4">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标题</TableHead>
                  <TableHead className="w-20">类型</TableHead>
                  <TableHead>话题</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="w-32">发布时间</TableHead>
                  <TableHead className="w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => setDetail(s)}
                  >
                    {/* 同 catalog 表格：长文本列 max-w+truncate，保证状态/时间/操作列在 1280px 内可见 */}
                    <TableCell className="max-w-[320px] truncate font-medium">
                      {s.title}
                    </TableCell>
                    <TableCell>{displayTypeLabel(s.type, s.content_category, undefined, s.track)}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {s.discipline}
                    </TableCell>
                    <TableCell>{statusBadge(s.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(s.submitted_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {s.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(s.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          撤回
                        </Button>
                      )}
                      {/* 公开后物化出的目录条目：作者需要一条直达自己已公开作品的路径，
                          否则公开之后整条链路就断在这里了 */}
                      {s.resource_id != null && (
                        <Button variant="ghost" size="sm" asChild>
                          <Link
                            to="/catalog/$resourceId"
                            params={{ resourceId: String(s.resource_id) }}
                          >
                            <ExternalLink className="h-4 w-4" />
                            查看作品
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        )
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
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{detail.type}</Badge>
                {statusBadge(detail.status)}
                <span className="text-muted-foreground">{detail.discipline}</span>
                <span className="text-muted-foreground">{detail.year}</span>
              </div>
              {statusHint(detail.status) && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {statusHint(detail.status)}
                </p>
              )}
              {detail.status === 'rework_requested' ? (
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">作品已退回修改</div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        先点「修改作品」按意见改完并保存；确认内容已更新后，再点「重新提交修改稿」。
                        只修改不重交，作品不会回到互评。
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void navigate({
                            to: '/submissions/new',
                            search: { edit: detail.id },
                          })
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                        修改作品
                      </Button>
                      <Button size="sm" onClick={() => setResubmitOpen(true)}>
                        <RefreshCw className="h-4 w-4" />
                        重新提交修改稿
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
              {detail.similarity_score != null && detail.similarity_score >= 35 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed">
                  <div className="mb-1 flex items-center gap-2 font-medium">
                    <span>站内相似度 {detail.similarity_score.toFixed(1)} / 100</span>
                    <Badge variant="outline">
                      {detail.similarity_score >= 70 ? '高度重复' : '建议核对'}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    这是与本站已公开内容、已有作品的文本重合度，不是任何外部查重系统的结论。相似不等于抄袭，请核对引用与原创表述。
                  </p>
                  {detail.similarity_matches && detail.similarity_matches.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {detail.similarity_matches.map((m) => (
                        <li key={`${m.kind}-${m.id}`} className="flex flex-wrap items-center gap-1">
                          <span className="text-muted-foreground">
                            {m.kind === 'resource' ? '已公开' : '作品'} #{m.id}
                          </span>
                          <span className="min-w-0 truncate">{m.title}</span>
                          <span className="tabular-nums text-muted-foreground">{m.score.toFixed(1)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              <WorkflowTimeline
                status={detail.status}
                submittedAt={new Date(detail.submitted_at)}
                reviewedAt={detail.reviewed_at ? new Date(detail.reviewed_at) : null}
              />
              <div>
                <span className="text-muted-foreground">署名：</span>
                {detail.authors.join(', ')}
              </div>
              {detail.venue && (
                <div>
                  <span className="text-muted-foreground">来源说明：</span>
                  {detail.venue}
                </div>
              )}
              {detail.subdiscipline && (
                <div>
                  <span className="text-muted-foreground">细分话题：</span>
                  {detail.subdiscipline}
                </div>
              )}
              {detail.keywords && detail.keywords.length > 0 && (
                <div>
                  <span className="text-muted-foreground">话题：</span>
                  {detail.keywords.join(', ')}
                </div>
              )}
              {detail.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detail.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              <div>
                <span className="text-muted-foreground">开头</span>
                <p className="mt-1 whitespace-pre-wrap">{normalizeAbstract(detail.abstract)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">预览</span>
                <p className="mt-1 whitespace-pre-wrap">{detail.preview}</p>
              </div>
              {detail.download_url && (
                <div>
                  <span className="text-muted-foreground">下载：</span>
                  {detail.download_url}
                </div>
              )}
              {detail.external_url && (
                <div>
                  <span className="text-muted-foreground">外部链接：</span>
                  {detail.external_url}
                </div>
              )}
              {detail.admin_note && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <span className="text-muted-foreground">整理备注：</span>
                  {detail.admin_note}
                </div>
              )}
              {detail.editor_note && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  {detail.status === 'rework_requested' ? (
                    <>
                      <div className="font-medium text-amber-900">修改要求与整理备注</div>
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">
                        {detail.editor_note}
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-muted-foreground">整理备注：</span>
                      {detail.editor_note}
                    </>
                  )}
                </div>
              )}
              {/* 公开后物化出的目录条目：已公开对访客可见；暂存草稿则
                  处于发布前阶段，仅内容整理与作者本人可预览（对外 404） */}
              {detail.resource_id != null &&
                (detail.resource_publication_status === 'published' ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <ExternalLink className="h-4 w-4" />
                      <span className="font-medium">已公开</span>
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      这篇作品已经公开，登录后可读。
                    </p>
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        to="/catalog/$resourceId"
                        params={{ resourceId: String(detail.resource_id) }}
                      >
                        查看作品页面
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <ExternalLink className="h-4 w-4" />
                      <span className="font-medium">发布前预览</span>
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      暂存为草稿，尚未公开：发布前只有内容整理和作者能看，公开后所有人可读。
                    </p>
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        to="/catalog/$resourceId"
                        params={{ resourceId: String(detail.resource_id) }}
                      >
                        预览公开页面
                      </Link>
                    </Button>
                  </div>
                ))}
              <div className="rounded-md border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span className="font-medium">作品文件</span>
                  {detail.file_path ? (
                    <Badge className="bg-emerald-500/15 text-emerald-700">
                      已上传
                    </Badge>
                  ) : (
                    <Badge variant="outline">未上传</Badge>
                  )}
                </div>
                {detail.file_path && (
                  <div className="mb-2 flex items-center gap-2">
                    <span className="break-all text-xs text-muted-foreground">
                      {detail.file_path}
                    </span>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                      onClick={() => void downloadSubmissionFile(detail.id, 'docx')}
                    >
                      <Download className="h-3.5 w-3.5" />
                      下载 Word
                    </button>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                      onClick={() => void downloadSubmissionFile(detail.id, 'pdf')}
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </button>
                  </div>
                )}
                {/* 仅 pending / major_revision / minor_revision / rework_requested 可上传 */}
                {['pending', 'major_revision', 'minor_revision', 'rework_requested'].includes(
                  detail.status,
                ) && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary hover:underline">
                    <Upload className="h-4 w-4" />
                    {detail.file_path ? '替换文件' : '上传作品'}
                    <input
                      type="file"
                      className="hidden"
                      accept={acceptAttr}
                      disabled={uploadMut.isPending}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) {
                          if (f.size > maxUploadBytes) {
                            toast.error(
                              `文件 ${(f.size / 1024 / 1024).toFixed(1)} MB 超过 ${uploadMaxMb} MB 上限，请改用网盘或仓库链接`,
                            )
                          } else {
                            void onUploadFile(f)
                          }
                        }
                        e.target.value = ''
                      }}
                    />
                  </label>
                )}
              </div>
              {/* 互评意见（单盲：作者只可见 comments_to_author，互评成员身份保密） */}
              {reportsQ.data && reportsQ.data.length > 0 && (
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span className="font-medium">互评意见</span>
                    <span className="text-xs text-muted-foreground">
                      （互评成员身份不公开）
                    </span>
                  </div>
                  <div className="space-y-2">
                    {reportsQ.data.map((r: ReviewReportResponse) => (
                      <div
                        key={r.id}
                        className="rounded bg-muted/50 p-2 text-sm"
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {new Date(r.submitted_at).toLocaleString()}
                          </span>
                        </div>
                        {r.comments_to_author ? (
                          <p className="whitespace-pre-wrap">
                            {r.comments_to_author}
                          </p>
                        ) : (
                          <p className="text-xs italic text-muted-foreground">
                            互评成员未留下意见
                          </p>
                        )}
                        {reviewDimensionEntries(r.scores).some(([, v]) =>
                          (v.suggestion ?? '').trim(),
                        ) && (
                          <div className="mt-2 space-y-0.5 border-t pt-1.5 text-xs">
                            <div className="font-medium text-muted-foreground">补充意见</div>
                            {reviewDimensionEntries(r.scores)
                              .filter(([, v]) => (v.suggestion ?? '').trim())
                              .map(([k, v]) => (
                                <p key={k}>· {v.suggestion}</p>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 作者逐条回复互评：仅在有已完成意见且处于待修改/再审状态时开放 */}
              {reportsQ.data &&
                reportsQ.data.length > 0 &&
                ['under_review', 'major_revision', 'minor_revision', 'resubmitted', 'rework_requested'].includes(
                  detail.status,
                ) && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4" />
                      <span className="font-medium">回复互评</span>
                      <span className="text-xs text-muted-foreground">
                        逐条回应互评意见，随作品保存给内容整理查看
                      </span>
                    </div>
                    <Textarea
                      rows={6}
                      value={authorResponseDraft}
                      onChange={(e) => setAuthorResponseDraft(e.target.value.slice(0, 20000))}
                      placeholder="例如：
互评 1 意见 1：已在第 3 节补充两组材料（表 4）。
互评 1 意见 2：已把结论范围收窄，见第 4 页。
互评 2 意见 1：该处表述已改写，并补充两条出处。"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {detail.author_response_at
                          ? `上次保存 ${new Date(detail.author_response_at).toLocaleString()}`
                          : '尚未保存'}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => void onSaveAuthorResponse()}
                        disabled={saveResponseMut.isPending}
                      >
                        {saveResponseMut.isPending ? '保存中…' : '保存回复'}
                      </Button>
                    </div>
                  </div>
                )}
              {/* 版本历史：v1 = 初次提交，之后每次提交新版本一个版本 */}
              {versionsQ.data && versionsQ.data.length > 0 && (
                <div className="rounded-md border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <History className="h-4 w-4" />
                    <span className="font-medium">版本历史</span>
                  </div>
                  <ol className="space-y-2">
                    {versionsQ.data.map((v) => (
                      <li key={v.id} className="flex gap-2 text-sm">
                        <Badge variant="outline" className="shrink-0">
                          v{v.version}
                        </Badge>
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">
                            {v.version === 1 ? '首次发布' : '更新版本'} ·{' '}
                            {new Date(v.created_at).toLocaleString()}
                            {v.file_path ? ' · 含作品文件' : ''}
                          </div>
                          {v.file_path && (
                            <button
                              type="button"
                              className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              onClick={() =>
                                void downloadSubmissionVersion(detail.id, v.version).catch(
                                  (err) => toast.error(extractError(err, '该版本原件不可下载')),
                                )
                              }
                            >
                              <Download className="h-3.5 w-3.5" />
                              下载该版本原件
                            </button>
                          )}
                          {v.note && (
                            <p className="mt-0.5 whitespace-pre-wrap text-sm">
                              修改说明：{v.note}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {/* 操作区：可编辑状态下开放「修改作品」（跳转三步向导）；待大改/待小改额外开放「更新版本」 */}
              {EDITABLE_STATUSES.includes(detail.status) && (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigate({
                        to: '/submissions/new',
                        search: { edit: detail.id },
                      })
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                    {detail.status === 'rework_requested' ? '继续修改' : '修改作品'}
                  </Button>
                  {['major_revision', 'minor_revision', 'rework_requested'].includes(
                    detail.status,
                  ) && (
                    <Button onClick={() => setResubmitOpen(true)}>
                      <RefreshCw className="h-4 w-4" />
                      {detail.status === 'rework_requested' ? '重新提交修改稿' : '更新版本'}
                    </Button>
                  )}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                发布于 {new Date(detail.submitted_at).toLocaleString()}
                {detail.reviewed_at && (
                  <>
                    {' · 整理于 '}
                    {new Date(detail.reviewed_at).toLocaleString()}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>


      {/* 更新版本 Dialog：可附「针对互评意见做了哪些修改」，随版本存档并通知内容整理 */}
      <Dialog
        open={resubmitOpen}
        onOpenChange={(o) => {
          setResubmitOpen(o)
          if (!o) setResubmitNote('')
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {detail?.status === 'rework_requested' ? '重新提交修改稿' : '更新版本'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {detail?.status === 'rework_requested'
                ? '重新提交会把当前内容存为一版，交回内容整理重新分配互评。请先确认「修改作品」里的改动已经保存；未改完就重交，会和上一版一样。'
                : '更新版本会把作品此刻的内容存为一版，交回内容整理。若还没改完，先关掉这里用「修改作品」编辑内容。'}
            </p>
            <div className="space-y-2">
              <Label htmlFor="resubmit-note">
                {detail?.status === 'rework_requested' ? '修改说明（建议填写）' : '修改说明（可选）'}
              </Label>
              <Textarea
                id="resubmit-note"
                rows={4}
                value={resubmitNote}
                onChange={(e) => setResubmitNote(e.target.value)}
                placeholder="例如：按互评意见补充了材料，重写了第 3 节。"
              />
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setResubmitOpen(false)}
              >
                取消
              </Button>
              <Button
                onClick={onResubmit}
                disabled={resubmitMut.isPending}
                data-testid="confirm-resubmit"
              >
                {resubmitMut.isPending
                  ? '处理中…'
                  : detail?.status === 'rework_requested'
                    ? '确认重新提交'
                    : '确认更新版本'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        title="撤回作品"
        description="确定撤回这件作品吗？撤回后需要重新发布。"
        confirmText="撤回"
        destructive
        onConfirm={onConfirmDelete}
        onOpenChange={(o) => !o && setDeleteId(null)}
      />
    </div>
  )
}
