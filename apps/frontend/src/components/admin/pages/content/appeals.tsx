import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Gavel } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminAppeals, useDecideAppeal } from '@/hooks/api/use-modules'
import type { AppealItem, AppealKind, AppealStatus } from '@/lib/types'
import { extractError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/common/state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const PAGE_SIZE = 20

const KIND_LABEL: Record<AppealKind, string> = {
  withdraw: '撤回作品',
  rescore: '重新核对分数',
  rescore_zone: '重新核对分区',
}

const STATUS_LABEL: Record<AppealStatus, string> = {
  pending: '待处理',
  accepted: '已通过',
  rejected: '已驳回',
}

const STATUS_STYLE: Record<AppealStatus, string> = {
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-700',
  accepted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
  rejected: 'border-border bg-muted text-muted-foreground',
}

const FILTERS: { value: AppealStatus; label: string }[] = [
  { value: 'pending', label: '待处理' },
  { value: 'accepted', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
]

function DecisionDialog({
  target,
  decision,
  onClose,
}: {
  target: AppealItem
  decision: 'accepted' | 'rejected'
  onClose: () => void
}) {
  const decide = useDecideAppeal()
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const withdraw = target.kind === 'withdraw' && decision === 'accepted'

  const submit = async () => {
    setError('')
    if (note.trim().length < 20) {
      setError('处理说明至少 20 字，作者会原样看到这段说明。')
      return
    }
    try {
      await decide.mutateAsync({
        appealId: target.id,
        status: decision,
        editorNote: note.trim(),
      })
      toast.success(decision === 'accepted' ? '申诉已通过' : '申诉已驳回')
      onClose()
    } catch (err) {
      setError(extractError(err, '处理失败'))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{decision === 'accepted' ? '通过申诉' : '驳回申诉'}</DialogTitle>
          <DialogDescription>
            《{target.resource_title}》· {KIND_LABEL[target.kind]} · 申请人 {target.username}
          </DialogDescription>
        </DialogHeader>
        {withdraw ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
            通过后会立即把作品从公开目录下架（改为草稿），不再对外展示。
          </p>
        ) : null}
        <div className="space-y-2">
          <p className="whitespace-pre-wrap rounded-md border bg-muted/25 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {target.reason}
          </p>
          <label htmlFor="appeal-editor-note" className="text-sm font-medium">
            处理说明（作者可见）
          </label>
          <Textarea
            id="appeal-editor-note"
            rows={5}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="写清为什么这样处理、后续会做什么。至少 20 字。"
          />
          <p className="text-right text-[11px] text-muted-foreground">{note.trim().length}/20 字起</p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            disabled={decide.isPending || note.trim().length < 20}
            variant={decision === 'rejected' ? 'outline' : 'default'}
            onClick={() => void submit()}
          >
            {decide.isPending ? '处理中…' : decision === 'accepted' ? '确认通过' : '确认驳回'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function AppealsPage({
  highlightAppealId,
  onClearHighlight,
}: {
  highlightAppealId?: number
  onClearHighlight?: () => void
}) {
  const [status, setStatus] = useState<AppealStatus>('pending')
  const [page, setPage] = useState(1)
  const focused = Boolean(highlightAppealId)
  const query = useAdminAppeals(
    focused ? 'all' : status,
    focused ? 1 : page,
    focused ? 1 : PAGE_SIZE,
    highlightAppealId,
  )
  const [decision, setDecision] = useState<{ target: AppealItem; decision: 'accepted' | 'rejected' } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!focused || !highlightAppealId) return
    const timer = window.setTimeout(() => {
      document.getElementById(`admin-appeal-${highlightAppealId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [focused, highlightAppealId, query.data])

  const items = query.data?.items ?? []
  const meta = query.data?.meta

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-xl">
            <Gavel className="h-5 w-5 text-primary" />
            作者申诉
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            申诉进入队列后按状态处理。通过“撤回作品”会立即下架；重核、重分区只记录决定，需内容整理另行核对。
          </p>
        </div>
        {meta && !focused ? <Badge variant="secondary">当前筛选 {meta.total} 条</Badge> : null}
      </div>

      {focused ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <span>正在查看通知指到的那条申诉（#{highlightAppealId}）。</span>
          <Button size="sm" variant="link" className="h-auto px-0" onClick={onClearHighlight}>
            回到完整队列
          </Button>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <Button
              key={item.value}
              size="sm"
              variant={status === item.value ? 'default' : 'outline'}
              onClick={() => {
                setStatus(item.value)
                setPage(1)
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}

      <div ref={listRef} className="space-y-3">
        {query.isLoading ? <p className="text-sm text-muted-foreground">加载中…</p> : null}
        {query.isError ? (
          <div className="flex items-center justify-between gap-3 border-y py-4 text-sm">
            <span className="text-muted-foreground">申诉队列加载失败，可重试。</span>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>重试</Button>
          </div>
        ) : null}
        {!query.isLoading && !query.isError && items.length === 0 ? (
          <EmptyState title={focused ? '这条申诉不存在或已删除' : '这个状态下没有申诉'} />
        ) : null}
        {items.map((item) => (
          <article
            key={item.id}
            id={`admin-appeal-${item.id}`}
            className={`rounded-lg border bg-card p-4 ${highlightAppealId === item.id ? 'ring-2 ring-primary/60 ring-offset-2' : ''}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={STATUS_STYLE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                  <Badge variant="secondary">{KIND_LABEL[item.kind]}</Badge>
                  <Link
                    to="/catalog/$resourceId"
                    params={{ resourceId: String(item.resource_id) }}
                    className="truncate text-sm font-medium hover:text-primary"
                  >
                    《{item.resource_title}》
                  </Link>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  申请人 {item.username} · #{item.id} · {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{item.reason}</p>
                {item.editor_note ? (
                  <div className="mt-3 rounded-md border-l-2 border-primary/40 bg-muted/25 px-3 py-2 text-xs leading-relaxed">
                    <span className="font-medium">处理说明：</span>{item.editor_note}
                    {item.decided_at ? <span className="ml-2 text-muted-foreground">{new Date(item.decided_at).toLocaleString()}</span> : null}
                  </div>
                ) : null}
              </div>
              {item.status === 'pending' ? (
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" onClick={() => setDecision({ target: item, decision: 'accepted' })}>通过</Button>
                  <Button size="sm" variant="outline" onClick={() => setDecision({ target: item, decision: 'rejected' })}>驳回</Button>
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {!focused && meta && meta.total_pages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </Button>
          <span className="text-muted-foreground">{meta.page} / {meta.total_pages}</span>
          <Button size="sm" variant="outline" disabled={page >= meta.total_pages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </Button>
        </div>
      ) : null}

      {decision ? (
        <DecisionDialog
          target={decision.target}
          decision={decision.decision}
          onClose={() => setDecision(null)}
        />
      ) : null}
    </div>
  )
}
