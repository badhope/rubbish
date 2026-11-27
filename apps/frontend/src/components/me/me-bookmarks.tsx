import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Bookmark, MessageSquare } from 'lucide-react'
import { api } from '@/lib/api'
import { ErrorState, Loading } from '@/components/common/state'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/common/pagination'

interface BookmarkTopic {
  id: number
  title: string
  body: string
  reply_count: number
  last_reply_at: string | null
  author: { username: string; display_name?: string | null } | null
}

interface BookmarkResponse {
  data: BookmarkTopic[]
  meta: { total: number; page: number; page_size: number; total_pages: number }
}

function excerpt(body: string, limit = 100): string {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, limit) + (text.length > limit ? '…' : '')
}

function ago(value: string | null): string {
  if (!value) return '刚刚'
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function MeBookmarks() {
  const [page, setPage] = useState(1)
  const query = useQuery<BookmarkResponse>({
    queryKey: ['forum', 'bookmarks', page],
    queryFn: async () => (await api.get<BookmarkResponse>('/forum/topics/bookmarks', { params: { page, page_size: 20 } })).data,
  })
  if (query.isLoading) return <Loading />
  if (query.isError) return <ErrorState message="加载帖子收藏失败" onRetry={() => query.refetch()} />
  const rows = query.data?.data ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">SAVED THREADS</p>
          <h2 className="mt-1 font-serif text-xl tracking-tight">帖子收藏</h2>
          <p className="mt-1 text-xs text-muted-foreground">在主题帖上点“收藏”，以后从这一页回来。共 {query.data?.meta.total ?? 0} 条。</p>
        </div>
        <Button size="sm" variant="outline" asChild><Link to="/forum">去主题论坛</Link></Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border-b py-8 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><Bookmark className="h-4 w-4" />还没有收藏的主题帖</span>
          <Button size="sm" variant="outline" asChild><Link to="/forum">找一条想回看的讨论</Link></Button>
        </div>
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {rows.map((topic) => (
            <article key={topic.id} className="group flex gap-3 px-4 py-4 transition-colors hover:bg-muted/20">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {(topic.author?.display_name || topic.author?.username || '?').slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{topic.author?.display_name || topic.author?.username || '已注销用户'}</span>
                  <span aria-hidden>·</span>
                  <span>最后活跃 {ago(topic.last_reply_at)}</span>
                  <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{topic.reply_count}</span>
                </div>
                <Link
                  to="/forum/$topicId"
                  params={{ topicId: String(topic.id) }}
                  className="mt-1 line-clamp-1 text-[15px] font-semibold hover:text-primary"
                >
                  {topic.title}
                </Link>
                <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{excerpt(topic.body)}</p>
              </div>
              <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-primary" />
            </article>
          ))}
        </div>
      )}
      {query.data && query.data.meta.total_pages > 1 ? (
        <Pagination page={query.data.meta.page} totalPages={query.data.meta.total_pages} onPageChange={setPage} />
      ) : null}
    </div>
  )
}
