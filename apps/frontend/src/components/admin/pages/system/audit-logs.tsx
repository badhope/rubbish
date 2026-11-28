import { useMemo, useState } from 'react'
import { Download, ExternalLink, Filter, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import {
  exportAdminAuditLogs,
  type AdminAuditFilters,
  useAdminAuditCount,
  useAdminAuditLogs,
} from '@/hooks/api/use-modules'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { auditActionLabel, auditTarget } from '@/lib/audit-labels'
import { downloadBlob, extractError, inferTotalPagesFromFullPage } from '@/lib/utils'

const PAGE_SIZE = 50

interface FilterDraft {
  action: string
  actor: string
  target: string
  start: string
  end: string
}

const EMPTY_FILTERS: FilterDraft = { action: '', actor: '', target: '', start: '', end: '' }

function toFilters(draft: FilterDraft): AdminAuditFilters {
  const filters: AdminAuditFilters = {}
  if (draft.action.trim()) filters.action = draft.action.trim()
  const actor = Number(draft.actor)
  if (draft.actor.trim() && Number.isInteger(actor) && actor > 0) filters.actorUserId = actor
  if (draft.target.trim()) filters.targetType = draft.target.trim()
  if (draft.start) filters.start = `${draft.start}T00:00:00+08:00`
  if (draft.end) filters.end = `${draft.end}T23:59:59+08:00`
  return filters
}

export default function AuditLogsPage() {
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<AdminAuditFilters>({})
  const [exporting, setExporting] = useState(false)
  const offset = (page - 1) * PAGE_SIZE
  const { data, isLoading, isError, refetch } = useAdminAuditLogs(PAGE_SIZE, offset, applied)
  const { data: countData } = useAdminAuditCount(applied)

  // 精确总数优先；接口异常时退回「当前页是否满页」的旧推断。
  const totalPages = countData
    ? Math.max(1, Math.ceil(countData.total / PAGE_SIZE))
    : inferTotalPagesFromFullPage(data ?? [], PAGE_SIZE, page)
  const activeCount = useMemo(() => Object.keys(applied).length, [applied])

  const apply = () => {
    if (draft.start && draft.end && draft.start > draft.end) {
      toast.info('开始日期不能晚于结束日期')
      return
    }
    if (draft.actor.trim() && (!Number.isInteger(Number(draft.actor)) || Number(draft.actor) <= 0)) {
      toast.info('操作者 ID 需为正整数')
      return
    }
    setApplied(toFilters(draft))
    setPage(1)
  }

  const reset = () => {
    setDraft(EMPTY_FILTERS)
    setApplied({})
    setPage(1)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const { blob, disposition } = await exportAdminAuditLogs(applied)
      downloadBlob(blob, disposition, '审计日志.csv')
      toast.success('已导出筛选结果，最多 5000 条')
    } catch (err) {
      toast.error(extractError(err, '导出失败，可重试。'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="审计日志"
        description="记录后台操作与关键事件。可按动作、操作者、目标类型和日期筛选；导出走同一套筛选条件，不另算一份。"
        actions={
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            <Download className="mr-1.5 h-4 w-4" />
            {exporting ? '导出中…' : '导出 CSV'}
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1.5">
            <Label htmlFor="audit-action" className="text-xs">动作前缀</Label>
            <Input
              id="audit-action"
              value={draft.action}
              onChange={(event) => setDraft((prev) => ({ ...prev, action: event.target.value }))}
              placeholder="forum.moderate"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-actor" className="text-xs">操作者 ID</Label>
            <Input
              id="audit-actor"
              value={draft.actor}
              onChange={(event) => setDraft((prev) => ({ ...prev, actor: event.target.value }))}
              placeholder="例如 89"
              inputMode="numeric"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-target" className="text-xs">目标类型</Label>
            <Input
              id="audit-target"
              value={draft.target}
              onChange={(event) => setDraft((prev) => ({ ...prev, target: event.target.value }))}
              placeholder="forum_topic"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-start" className="text-xs">开始日期</Label>
            <Input
              id="audit-start"
              type="date"
              value={draft.start}
              onChange={(event) => setDraft((prev) => ({ ...prev, start: event.target.value }))}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="audit-end" className="text-xs">结束日期</Label>
            <Input
              id="audit-end"
              type="date"
              value={draft.end}
              onChange={(event) => setDraft((prev) => ({ ...prev, end: event.target.value }))}
              className="h-9"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={apply}>
              <Filter className="mr-1.5 h-4 w-4" />
              筛选
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              <RotateCcw className="mr-1.5 h-4 w-4" />
              重置
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeCount > 0 ? (
        <p className="mb-3 text-xs text-muted-foreground">
          当前有 {activeCount} 个筛选条件；分页按筛选后的结果计算，导出上限 5000 条。
        </p>
      ) : null}

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="审计日志加载失败，可重试。" onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title={activeCount > 0 ? '没有符合筛选条件的日志' : '暂无审计日志'} />
      ) : (
        <div className="space-y-2.5">
          {data.map((log) => {
            const target = auditTarget(log)
            const actor = log.actor_name || (log.actor_user_id ? `成员 #${log.actor_user_id}` : '系统')
            return (
              <Card key={log.id} className="py-3.5">
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-normal">
                      {auditActionLabel(log.action)}
                    </Badge>
                    {target ? (
                      target.href ? (
                        <a
                          href={target.href}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          {target.label}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">{target.label}</span>
                      )
                    ) : null}
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {new Date(log.created_at).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    操作者：{actor}
                  </p>
                  {log.payload ? (
                    <details className="rounded-md border bg-muted/20 px-2.5 py-2 text-xs">
                      <summary className="cursor-pointer select-none text-muted-foreground">
                        查看原始记录
                      </summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-transparent p-0 text-[11px] leading-relaxed">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {data && data.length > 0 ? (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      ) : null}
    </div>
  )
}
