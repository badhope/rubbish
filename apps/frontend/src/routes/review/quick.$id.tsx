import { useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, Download, FileText, Send } from 'lucide-react'
import { toast } from 'sonner'
import { getAuthState } from '@/lib/auth'
import {
  downloadSubmissionFile,
  useAcceptAssignment,
  useReviewAssignment,
  useReviewSubmissionDetail,
  useSubmitReview,
  useUploadReviewAttachment,
} from '@/hooks/api/use-modules'
import type { ReviewSubmit } from '@/lib/types'
import { extractError } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { MarkdownContent } from '@/components/common/markdown-content'
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/common/state'
import { ReviewAttachmentPicker } from '@/components/common/review-attachments'
import {
  EMPTY_REVIEW_FORM,
  ReviewReportFields,
  type ReviewFormValue,
} from '@/components/review/review-report-fields'
import {
  TRACK_DIMENSIONS,
  dimensionIssue,
  scoreReviewTotal,
} from '@/components/review/rubric-score-fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export const Route = createFileRoute('/review/quick/$id')({
  beforeLoad: () => {
    if (!getAuthState().isAuthenticated) throw redirect({ to: '/login' })
  },
  component: QuickReviewPage,
})

function QuickReviewPage() {
  const { id } = Route.useParams()
  const assignmentId = Number(id)
  const navigate = useNavigate()
  const assignment = useReviewAssignment(assignmentId)
  const submission = useReviewSubmissionDetail(assignmentId)
  const acceptMut = useAcceptAssignment()
  const submitMut = useSubmitReview()
  const uploadMut = useUploadReviewAttachment()
  const [form, setForm] = useState<ReviewFormValue>(EMPTY_REVIEW_FORM)
  const [files, setFiles] = useState<File[]>([])

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (form.special_issue && form.special_issue_reason.trim().length < 10) {
      toast.error('勾选「特别篇」后必须填写不少于 10 字的理由')
      return
    }
    const dims = TRACK_DIMENSIONS[form.track]
    const incomplete = dims
      .filter((dim) => dimensionIssue(dim, form.dimensions[dim.key]) !== null)
      .map((dim) => `${dim.label}（${dimensionIssue(dim, form.dimensions[dim.key])}）`)
    if (incomplete.length) {
      toast.error(`还有 ${incomplete.length} 个维度未完成：${incomplete.join('、')}`)
      return
    }
    const summary = scoreReviewTotal(form.track, form.dimensions)
    const body: ReviewSubmit = {
      recommendation: form.recommendation,
      scores: {
        rubric_version: '5.1',
        track: form.track,
        dimensions: Object.fromEntries(
          dims.map((dim) => [
            dim.key,
            {
              score: form.dimensions[dim.key]?.score,
              reason: form.dimensions[dim.key]?.reason.trim(),
              evidence: form.dimensions[dim.key]?.evidence.trim(),
            },
          ]),
        ),
        score: summary.total,
        grade: summary.grade,
      },
      comments_to_editor: form.comments_to_editor || undefined,
      comments_to_author: form.comments_to_author || undefined,
      special_issue: form.special_issue || undefined,
      special_issue_reason: form.special_issue
        ? form.special_issue_reason || '审稿人确认篇幅特许'
        : undefined,
    }
    try {
      const report = await submitMut.mutateAsync({ id: assignmentId, body })
      for (const file of files) {
        try {
          await uploadMut.mutateAsync({ reportId: report.id, file })
        } catch (err) {
          toast.warning(`报告已提交，但附件「${file.name}」上传失败：${extractError(err, '请稍后补传')}`)
        }
      }
      toast.success(files.length ? '快速评审与附件已提交' : '快速评审已提交')
      void navigate({ to: '/review/assignments' })
    } catch (err) {
      toast.error(extractError(err, '提交失败'))
    }
  }

  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return <EmptyState title="无效的审稿任务" description="请从审稿工作台进入。" />
  }

  if (assignment.isLoading || submission.isLoading) return <LoadingSkeleton rows={4} />
  if (assignment.isError || !assignment.data) {
    return <ErrorState message="审稿任务加载失败" onRetry={() => assignment.refetch()} />
  }
  const a = assignment.data
  const s = submission.data

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="快速评审"
        description="为手机端准备的单页评审：上面读稿，下面打分，提交后即可回到任务列表。"
        actions={
          <Link to="/review/assignments">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
              返回工作台
            </Button>
          </Link>
        }
      />

      <Card className="mb-4">
        <CardContent className="space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{a.status === 'pending' ? '待接受' : a.status === 'accepted' ? '已接受' : a.status === 'completed' ? '已完成' : a.status}</Badge>
            {a.due_date ? <span className="text-xs text-muted-foreground">截止 {new Date(a.due_date).toLocaleString()}</span> : null}
            {a.round ? <span className="text-xs text-muted-foreground">第 {a.round} 轮</span> : null}
          </div>
          <h2 className="font-medium">{a.submission_title ?? `稿件 #${a.submission_id}`}</h2>
          {a.status === 'pending' ? (
            <Button
              size="sm"
              disabled={acceptMut.isPending}
              onClick={() =>
                acceptMut.mutate(a.id, {
                  onSuccess: () => toast.success('已接受邀请，可以开始快速评审'),
                  onError: (err) => toast.error(extractError(err, '接受失败')),
                })
              }
            >
              <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />
              接受邀请
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {s ? (
        <Card className="mb-4">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">稿件内容</h3>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void downloadSubmissionFile(s.id, 'docx')}>
                  <Download className="mr-1 h-4 w-4" aria-hidden /> Word
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void downloadSubmissionFile(s.id, 'pdf')}>
                  <Download className="mr-1 h-4 w-4" aria-hidden /> PDF
                </Button>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{s.abstract}</p>
            {s.keywords?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {s.keywords.slice(0, 8).map((keyword) => (
                  <Badge key={keyword} variant="secondary">{keyword}</Badge>
                ))}
              </div>
            ) : null}
            {s.manuscript_body ? (
              <details className="rounded-md border p-3" open>
                <summary className="cursor-pointer text-sm font-medium">在线阅读全文</summary>
                <div className="mt-3 max-h-[44vh] overflow-y-auto">
                  <MarkdownContent text={s.manuscript_body} className="text-sm" />
                </div>
              </details>
            ) : (
              <p className="text-xs text-muted-foreground">该稿没有在线全文，请下载 Word/PDF 阅读后填写评审。</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {a.status !== 'accepted' ? (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {a.status === 'completed'
            ? '这份审稿已完成。你可以回到工作台查看报告或补传附件。'
            : '接受邀请后才可以填写快速评审。'}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4" aria-hidden /> 评审表
              </div>
              <ReviewReportFields value={form} onChange={setForm} disabled={submitMut.isPending} />
              <ReviewAttachmentPicker files={files} onChange={setFiles} disabled={submitMut.isPending} />
            </CardContent>
          </Card>
          <div className="sticky bottom-0 flex gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur">
            <Button type="button" variant="outline" onClick={() => void navigate({ to: '/review/assignments' })}>
              取消
            </Button>
            <Button type="submit" className="flex-1" disabled={submitMut.isPending}>
              <Send className="mr-1 h-4 w-4" aria-hidden />
              {submitMut.isPending ? '提交中…' : '提交快速评审'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
