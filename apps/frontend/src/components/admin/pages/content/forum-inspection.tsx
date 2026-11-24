import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Lock,
  LockOpen,
  MessageSquare,
  Pin,
  PinOff,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import { extractError } from '@/lib/utils'
import { plainTextPreview } from '@/lib/text-preview'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface TopicRow {
  id: number
  title: string
  body: string
  board_name: string | null
  board_path: string | null
  is_pinned: boolean
  is_locked: boolean
  reply_count: number
  created_at: string
  last_reply_at: string | null
  author: { id: number; username: string; display_name?: string | null } | null
}

interface TopicPage {
  data: TopicRow[]
  meta: { total: number; page: number; page_size: number; total_pages: number }
}

interface ReportRow {
  id: number
  status: string
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ForumInspectionPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'latest' | 'hot'>('latest')

  const topicsQ = useQuery({
    queryKey: ['admin', 'forum-inspection', page, sort],
    queryFn: async () =>
      (await api.get<TopicPage>('/forum/topics', { params: { page, page_size: 50, sort, include_pending: true } })).data,
  })

  const reportsQ = useQuery({
    queryKey: ['forum', 'reports', 'open', 'inspection-count'],
    queryFn: async () => (await api.get<ReportRow[]>('/forum/reports', { params: { status_filter: 'open' } })).data,
  })

  const moderate = useMutation({
    mutationFn: async (payload: { id: number; is_pinned?: boolean; is_locked?: boolean }) =>
      (await api.patch(`/forum/topics/${payload.id}`, payload)).data,
    onSuccess: () => {
      toast.success('已更新巡检状态')
      void qc.invalidateQueries({ queryKey: ['admin', 'forum-inspection'] })
      void qc.invalidateQueries({ queryKey: ['forum', 'topics'] })
    },
    onError: (err) => toast.error(extractError(err, '没能更新巡检状态，可再试一次')),
  })

  const rows = useMemo(() => topicsQ.data?.data ?? [], [topicsQ.data])
  const meta = topicsQ.data?.meta
  const openReports = reportsQ.data?.length ?? 0

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) =>
      [row.title, plainTextPreview(row.body, 10000), row.author?.display_name, row.author?.username, row.board_name]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
  }, [query, rows])

  return (
    <div>
      <PageHeader
        title="主题巡检"
        description="按最近活跃或热度查看全站主题帖，置顶、锁定、跳转处理举报。巡检只做日常维护，不替代人工核验队列。"
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">全站主题帖</p>
              <p className="mt-1 font-mono text-2xl font-semibold">{meta?.total ?? '—'}</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">本页主题帖</p>
              <p className="mt-1 font-mono text-2xl font-semibold">{filtered.length}</p>
              {meta ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  共 {meta.total} 条 · 第 {meta.page} / {meta.total_pages} 页
                </p>
              ) : null}
            </div>
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">待处理举报</p>
              <p className="mt-1 font-mono text-2xl font-semibold text-destructive">{openReports}</p>
            </div>
            <Link to="/admin" search={{ section: 'reports' }} className="text-sm text-primary hover:underline">
              去处理
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜标题、正文、作者或分区"
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={sort === 'latest' ? 'default' : 'outline'} onClick={() => { setSort('latest'); setPage(1) }}>
            最近活跃
          </Button>
          <Button size="sm" variant={sort === 'hot' ? 'default' : 'outline'} onClick={() => { setSort('hot'); setPage(1) }}>
            热度
          </Button>
        </div>
      </div>

      {topicsQ.isLoading ? (
        <Loading />
      ) : topicsQ.isError ? (
        <ErrorState message="主题帖加载失败，可重试。" onRetry={() => topicsQ.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query ? '没有匹配的主题' : '主题论坛还没有主题帖'}
          description={query ? '换一个主题帖试试。' : '用户发布主题帖后会出现在这里。'}
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <Card key={row.id}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={`/forum/${row.id}`} target="_blank" rel="noreferrer" className="truncate text-sm font-medium hover:underline">
                        {row.title}
                      </a>
                      {row.is_pinned ? <Badge variant="secondary">置顶</Badge> : null}
                      {row.is_locked ? <Badge variant="outline">已锁定</Badge> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {plainTextPreview(row.body, 160)}
                    </p>
                    <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{row.board_path || row.board_name || '未分区'}</span>
                      <span>作者：{row.author?.display_name || row.author?.username || '已注销'}</span>
                      <span>{row.reply_count} 层互动</span>
                      <span>发布 {fmtTime(row.created_at)}</span>
                      <span>最后活跃 {fmtTime(row.last_reply_at)}</span>
                    </p>
                  </div>
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
                    <Button size="sm" variant="outline" asChild>
                      <a href={`/forum/${row.id}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                        查看
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={moderate.isPending}
                      onClick={() => moderate.mutate({ id: row.id, is_pinned: !row.is_pinned })}
                    >
                      {row.is_pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      {row.is_pinned ? '取消置顶' : '置顶'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={moderate.isPending}
                      onClick={() => moderate.mutate({ id: row.id, is_locked: !row.is_locked })}
                    >
                      {row.is_locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      {row.is_locked ? '解锁' : '锁定'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {meta && meta.total_pages > 1 ? (
        <div className="mt-4 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            第 {meta.page} / {meta.total_pages} 页 · 共 {meta.total} 条
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ArrowLeft className="h-3.5 w-3.5" />
              上一页
            </Button>
            <Button size="sm" variant="outline" disabled={page >= meta.total_pages} onClick={() => setPage((p) => p + 1)}>
              下一页
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
