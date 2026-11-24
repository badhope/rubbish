import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { MessagesSquare, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { useResources } from '@/hooks/api/use-modules'
import type { ResourceResponse } from '@/lib/types'
import { shortDate } from '@/components/me/format'
import { PageHeader } from '@/components/common/page-header'
import { CatalogIndexRow } from './catalog/-catalog-index-row'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q.trim() : undefined,
  }),
  component: SearchPage,
})

interface SearchTopic {
  id: number
  title: string
  body: string
  board_name: string | null
  reply_count: number
  created_at: string
  author: { username: string; display_name?: string | null } | null
}

interface TopicListResponse {
  data: SearchTopic[]
  meta: { total: number }
}

function SearchPage() {
  const navigate = useNavigate()
  const { q } = Route.useSearch()
  const [input, setInput] = useState(q ?? '')

  useEffect(() => {
    setInput(q ?? '')
  }, [q])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next = input.trim()
    void navigate({ to: '/search', search: next ? { q: next } : {} })
  }

  const resources = useResources({ q, page_size: 10 }, Boolean(q))
  const topics = useQuery({
    queryKey: ['forum', 'search', q] as const,
    queryFn: async () =>
      (await api.get<TopicListResponse>('/forum/topics', { params: { q, page_size: 10 } })).data,
    enabled: Boolean(q),
    placeholderData: (prev) => prev,
  })

  const resourceRows = resources.data?.data ?? []
  const topicRows = topics.data?.data ?? []

  return (
    <div className="mx-auto w-full max-w-[880px] space-y-6">
      <PageHeader title="站内搜索" description="同一个词，同时找内容库的作品和主题论坛的主题帖。" />

      <form onSubmit={submit} className="relative" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="标题、作者、标签或话题正文"
          aria-label="站内检索词"
          className="h-10 pl-9 pr-3"
        />
      </form>

      {!q ? (
        <EmptyState
          title="输入一个词，开始找"
          description="作品按标题、作者、开头与标签匹配；主题帖按标题和正文匹配。"
        />
      ) : (
        <>
          <section aria-label="作品结果" className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">作品</h2>
              <span className="text-xs text-muted-foreground">
                {resourceRows.length > 0 ? `命中 ${resourceRows.length} 条` : '没有命中'}
              </span>
            </div>
            {resources.isPending ? (
              <Loading />
            ) : resources.isError ? (
              <ErrorState message="作品结果没加载出来" onRetry={() => void resources.refetch()} />
            ) : resourceRows.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
                没有与「{q}」匹配的作品。可以换更短的词，或
                <Link to="/catalog" className="mx-1 text-primary hover:underline">
                  回内容库浏览
                </Link>
                。
              </p>
            ) : (
              <ul className="divide-y">
                {resourceRows.map((r: ResourceResponse, i) => (
                  <li key={r.id}>
                    <CatalogIndexRow resource={r} query={q} index={i + 1} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="主题帖结果" className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">主题帖</h2>
              <span className="text-xs text-muted-foreground">
                {topicRows.length > 0 ? `命中 ${topicRows.length} 条` : '没有命中'}
              </span>
            </div>
            {topics.isPending ? (
              <Loading />
            ) : topics.isError ? (
              <ErrorState message="主题帖结果没加载出来" onRetry={() => void topics.refetch()} />
            ) : topicRows.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
                没有与「{q}」匹配的主题帖。可以换个说法，或
                <Link to="/forum" className="mx-1 text-primary hover:underline">
                  去主题论坛看看
                </Link>
                。
              </p>
            ) : (
              <ul className="space-y-3">
                {topicRows.map((t) => (
                  <li key={t.id}>
                    <Link
                      to="/forum/$topicId"
                      params={{ topicId: String(t.id) }}
                      className="group block rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="line-clamp-1 text-sm font-medium group-hover:text-primary">
                          {t.title}
                        </span>
                      </span>
                      {t.body ? (
                        <span className="mt-1.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                          {t.body}
                        </span>
                      ) : null}
                      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="truncate">
                          {t.author?.display_name || t.author?.username || '匿名'}
                        </span>
                        {t.board_name ? <span>· {t.board_name}</span> : null}
                        <span>· {shortDate(t.created_at)}</span>
                        <span>· {t.reply_count} 条回应</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {resourceRows.length === 0 && topicRows.length === 0 && !resources.isError && !topics.isError && (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" asChild>
                <Link to="/catalog">去内容库</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/forum">去主题论坛</Link>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
