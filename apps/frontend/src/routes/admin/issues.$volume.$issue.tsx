import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, FilePlus2, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { requireAdminGuard } from '@/lib/route-guards'
import {
  useAssignIssueResources,
  useJournalVolumes,
  usePublishIssue,
  usePublishIssueContainer,
  useRemoveIssueResource,
  useResources,
  useUpdateResource,
} from '@/hooks/api/use-modules'
import { ARTICLE_SECTION_OPTIONS } from '@/lib/article-sections'
import type { ResourceResponse } from '@/lib/types'
import { extractError } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/admin/issues/$volume/$issue')({
  beforeLoad: () => {
    requireAdminGuard()
  },
  component: AdminIssueDetailPage,
})

const UNSET_PART = '__unset__'
const SECTION_LABEL: Record<string, string> = Object.fromEntries(
  ARTICLE_SECTION_OPTIONS.map((item) => [item.value, item.label]),
)
SECTION_LABEL[UNSET_PART] = '未分部'

function AdminIssueDetailPage() {
  const { volume, issue } = Route.useParams()
  const { data, isLoading, isError, refetch } = useResources({
    volume,
    issue,
    page_size: 100,
    sort: 'issue',
    order: 'asc',
  })
  const { data: volumes = [] } = useJournalVolumes()
  const updateMut = useUpdateResource()
  const publishMut = usePublishIssue()
  const publishContainer = usePublishIssueContainer()
  const assignMut = useAssignIssueResources()
  const removeMut = useRemoveIssueResource()
  const [draftParts, setDraftParts] = useState<Record<number, string>>({})
  const [moveOpen, setMoveOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<number>>(() => new Set())

  const issueRow = useMemo(
    () =>
      volumes
        .flatMap((volumeRow) => volumeRow.issues.map((row) => ({ volume: volumeRow, issue: row })))
        .find((entry) => entry.volume.number === volume && entry.issue.number === issue),
    [volumes, volume, issue],
  )

  const rows = useMemo(() => data?.data ?? [], [data])
  const groups = useMemo(() => {
    const map = new Map<string, ResourceResponse[]>()
    for (const row of rows) {
      const key = row.issue_part || UNSET_PART
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === UNSET_PART) return 1
      if (b === UNSET_PART) return -1
      return (SECTION_LABEL[a] ?? a).localeCompare(SECTION_LABEL[b] ?? b)
    })
  }, [rows])

  const candidates = useResources(
    { q: search.trim() || undefined, page_size: 50, sort: 'created_at', order: 'desc' },
    moveOpen,
  )

  const onSavePart = async (row: ResourceResponse) => {
    const next = draftParts[row.id]
    if (!next) return
    try {
      await updateMut.mutateAsync({
        id: row.id,
        body: { issue_part: next === UNSET_PART ? null : next },
      })
      toast.success(`《${row.title}》已归入${SECTION_LABEL[next]}`)
      setDraftParts((prev) => {
        const copy = { ...prev }
        delete copy[row.id]
        return copy
      })
      void refetch()
    } catch (err) {
      toast.error(extractError(err, '保存失败'))
    }
  }

  const onMoveIn = async () => {
    if (!issueRow) {
      toast.error('没有找到这期的实体记录，请先在卷期页保存一次或完成迁移')
      return
    }
    if (selected.size === 0) {
      toast.error('先选择要移入的文章')
      return
    }
    try {
      await assignMut.mutateAsync({ issueId: issueRow.issue.id, resourceIds: [...selected] })
      toast.success(`已移入 ${selected.size} 篇`)
      setSelected(new Set())
      setMoveOpen(false)
      void refetch()
    } catch (err) {
      toast.error(extractError(err, '移入失败'))
    }
  }

  const onRemove = async (row: ResourceResponse) => {
    if (!issueRow) return
    if (!window.confirm(`把《${row.title}》移出本期？不会删除文章，只解除本期归属。`)) return
    try {
      await removeMut.mutateAsync({ issueId: issueRow.issue.id, resourceId: row.id })
      toast.success('已移出本期')
      void refetch()
    } catch (err) {
      toast.error(extractError(err, '移出失败'))
    }
  }

  const onPublish = async () => {
    if (!window.confirm(`确认将 Vol. ${volume} Issue ${issue} 的已发布文章整期上线？`)) return
    try {
      await publishMut.mutateAsync({ volume, issue, publishAt: null })
      if (issueRow) await publishContainer.mutateAsync(issueRow.issue.id)
      toast.success('本期已发布')
      void refetch()
    } catch (err) {
      toast.error(extractError(err, '发布失败'))
    }
  }

  return (
    <div>
      <PageHeader
        title={issueRow?.issue.title || `Vol. ${volume} — Issue ${issue}`}
        description={
          issueRow?.issue.intro ||
          '按分部逐篇核对内容归属；归位后整期发布，发布只影响已通过门禁的文章。'
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {issueRow ? (
              <Badge variant={issueRow.issue.status === 'live' ? 'default' : 'secondary'}>
                {issueRow.issue.status === 'live'
                  ? '已上线'
                  : issueRow.issue.status === 'scheduled'
                    ? '已排期'
                    : issueRow.issue.status === 'archived'
                      ? '已归档'
                      : '草稿'}
              </Badge>
            ) : null}
            {data ? <Badge variant="secondary">{rows.length} 篇</Badge> : null}
            <Button size="sm" variant="outline" onClick={() => setMoveOpen(true)} disabled={!issueRow}>
              <FilePlus2 className="mr-1 h-4 w-4" />
              移入文章
            </Button>
            <Button
              size="sm"
              onClick={() => void onPublish()}
              disabled={publishMut.isPending || rows.length === 0}
            >
              <Send className="mr-1 h-4 w-4" />
              {publishMut.isPending ? '发布中…' : '发布本期'}
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/journal" search={{ section: 'volumes', volume }}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                返回卷期
              </Link>
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="加载本期文章失败" onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="本期还没有文章"
          description="期可以先空着。点右上角「移入文章」，从目录里选择要归入本期的稿件；也可以直接在资源录入时填本期的卷期号。"
          action={
            <Button onClick={() => setMoveOpen(true)} size="sm" disabled={!issueRow}>
              <FilePlus2 className="mr-1 h-4 w-4" />
              移入文章
            </Button>
          }
          compact
        />
      ) : (
        <div className="space-y-8">
          {groups.map(([part, items]) => (
            <section key={part} className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-base font-semibold">{SECTION_LABEL[part] ?? part}</h2>
                <span className="text-xs text-muted-foreground">{items.length} 篇</span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {items.map((row) => {
                  const value = draftParts[row.id] ?? (row.issue_part || UNSET_PART)
                  const dirty = value !== (row.issue_part || UNSET_PART)
                  return (
                    <div key={row.id} className="rounded-lg border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            to="/catalog/$resourceId"
                            params={{ resourceId: String(row.id) }}
                            className="line-clamp-2 text-sm font-medium underline-offset-4 hover:underline"
                          >
                            《{row.title}》
                          </Link>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {row.authors?.slice(0, 3).join('、') || '未署名'}
                            {row.year ? ` · ${row.year}` : ''}
                          </p>
                        </div>
                        <Badge variant={row.publication_status === 'published' ? 'outline' : 'secondary'}>
                          {row.publication_status === 'published' ? '已上线' : '未上线'}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <select
                          value={value}
                          onChange={(event) =>
                            setDraftParts((prev) => ({ ...prev, [row.id]: event.target.value }))
                          }
                          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          {ARTICLE_SECTION_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                          <option value={UNSET_PART}>未分部</option>
                        </select>
                        <Button
                          size="sm"
                          variant={dirty ? 'default' : 'outline'}
                          disabled={!dirty || updateMut.isPending}
                          onClick={() => void onSavePart(row)}
                        >
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void onRemove(row)}
                          disabled={removeMut.isPending}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          移出
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>移入文章</DialogTitle>
            <DialogDescription>
              从目录里搜索并勾选文章，移入后会把卷期号同步为 {volume} / {issue}。不会改变文章的录用或发布状态。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标题、作者、DOI"
            />
            <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
              {candidates.isLoading ? (
                <Loading />
              ) : (candidates.data?.data ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">没有找到文章</p>
              ) : (
                candidates.data?.data.map((resource) => {
                  const alreadyHere = rows.some((row) => row.id === resource.id)
                  return (
                    <label
                      key={resource.id}
                      className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={selected.has(resource.id)}
                        disabled={alreadyHere}
                        onChange={(event) => {
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (event.target.checked) next.add(resource.id)
                            else next.delete(resource.id)
                            return next
                          })
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">《{resource.title}》</span>
                        <span className="block text-xs text-muted-foreground">
                          {alreadyHere
                            ? '已在本期'
                            : `${resource.authors?.slice(0, 3).join('、') || '未署名'}${resource.year ? ` · ${resource.year}` : ''}`}
                        </span>
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void onMoveIn()} disabled={assignMut.isPending || selected.size === 0}>
              移入 {selected.size} 篇
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
