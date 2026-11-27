import { useEffect, useState, type ReactNode } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  BookOpen,
  FileText,
  MessagesSquare,
  Search,
  Tag,
} from 'lucide-react'
import type { ExploreResourceCard, ExploreTopicCard } from '@/hooks/api/use-explore'
import { useUnifiedSearch, type SearchKind } from '@/hooks/api/use-search'
import { displayTypeLabel } from '@/lib/resource-labels'
import { shortDate } from '@/components/me/format'
import { Highlight } from '@/components/common/highlight'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/search')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; type?: Exclude<SearchKind, 'all'>; page?: number } => {
    const q = typeof search.q === 'string' && search.q.trim() ? search.q.trim() : undefined
    const type =
      search.type === 'resources' ||
      search.type === 'topics' ||
      search.type === 'people' ||
      search.type === 'tags'
        ? search.type
        : undefined
    const page = typeof search.page === 'number' && search.page > 1 ? Math.floor(search.page) : undefined
    return { q, type, page }
  },
  component: SearchPage,
})

function compact(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function MetaLine({ children }: { children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      {children}
    </span>
  )
}

function ResourceResult({ row, query }: { row: ExploreResourceCard; query: string }) {
  return (
    <Link
      to="/catalog/$resourceId"
      params={{ resourceId: String(row.id) }}
      className="group flex gap-3 py-4 transition-colors hover:text-primary"
    >
      {row.cover_image ? (
        <img
          src={row.cover_image}
          alt=""
          className="h-[72px] w-[54px] shrink-0 rounded-md border object-cover"
        />
      ) : (
        <span className="flex h-[72px] w-[54px] shrink-0 items-center justify-center rounded-md border bg-primary/5 text-primary/70">
          <BookOpen className="h-4 w-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[15px] font-medium leading-snug">
          <Highlight text={row.short_title?.trim() || row.title} query={query} />
        </span>
        <MetaLine>
          <span>{displayTypeLabel(row.type, row.content_category, row.content_track, row.track)}</span>
          <span>· {row.discipline}</span>
          <span>· {row.year}</span>
        </MetaLine>
        {row.excerpt ? (
          <span className="mt-1.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
            {row.excerpt}
          </span>
        ) : null}
        <MetaLine>
          <span>{row.author_name}</span>
          {row.reads > 0 ? <span>· {compact(row.reads)} 阅读</span> : null}
        </MetaLine>
      </span>
      <ArrowRight className="mt-1 hidden h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary sm:block" />
    </Link>
  )
}

function TopicResult({ row, query }: { row: ExploreTopicCard; query: string }) {
  return (
    <Link
      to="/forum/$topicId"
      params={{ topicId: String(row.id) }}
      className="group block rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <span className="flex min-w-0 items-start gap-2">
        <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">
          <Highlight text={row.title} query={query} />
        </span>
      </span>
      {row.excerpt ? (
        <span className="mt-1.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
          <Highlight text={row.excerpt} query={query} />
        </span>
      ) : null}
      <MetaLine>
        <span>{row.author_name}</span>
        <span>· {row.reply_count} 条回应</span>
        {row.last_reply_at ? <span>· {shortDate(row.last_reply_at)}</span> : null}
      </MetaLine>
    </Link>
  )
}

function TagResult({ row }: { row: { name: string; count: number } }) {
  return (
    <Link
      to="/search"
      search={{ q: row.name, type: 'resources' }}
      className="inline-flex max-w-full items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-xs transition-colors hover:border-primary/40 hover:text-primary"
    >
      <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{row.name}</span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{row.count}</span>
    </Link>
  )
}

function PersonResult({
  row,
}: {
  row: {
    username: string
    display_name?: string | null
    avatar_url?: string | null
    bio?: string | null
    affiliation?: string | null
    works: number
    followers: number
  }
}) {
  return (
    <Link
      to="/u/$username"
      params={{ username: row.username }}
      className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
    >
      {row.avatar_url ? (
        <img src={row.avatar_url} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-serif text-lg text-primary">
          {(row.display_name || row.username).slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium group-hover:text-primary">
          {row.display_name || row.username}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">@{row.username}</span>
        {row.bio || row.affiliation ? (
          <span className="mt-1.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
            {row.bio || row.affiliation}
          </span>
        ) : null}
        <span className="mt-2 block text-[11px] text-muted-foreground">
          {row.works} 篇作品 · {row.followers} 关注者
        </span>
      </span>
    </Link>
  )
}

function SectionHead({
  title,
  count,
  onMore,
}: {
  title: string
  count: number
  onMore?: () => void
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b pb-2">
      <h2 className="text-sm font-medium">
        {title} <span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground">{count}</span>
      </h2>
      {onMore && count > 0 ? (
        <button
          type="button"
          onClick={onMore}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
        >
          看全部 <ArrowRight className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  )
}

function SearchPage() {
  const navigate = useNavigate()
  const { q, type, page = 1 } = Route.useSearch()
  const [input, setInput] = useState(q ?? '')
  const kind: SearchKind = type ?? 'all'
  const query = useUnifiedSearch(kind, q, page)

  useEffect(() => {
    setInput(q ?? '')
  }, [q])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next = input.trim()
    void navigate({
      to: '/search',
      search: next ? { q: next } : {},
    })
  }

  const go = (nextKind: SearchKind, nextPage = 1) => {
    if (!q) return
    void navigate({
      to: '/search',
      search: {
        q,
        ...(nextKind === 'all' ? {} : { type: nextKind }),
        ...(nextPage > 1 ? { page: nextPage } : {}),
      },
    })
  }

  const data = query.data
  const totals = data?.meta.totals
  const pageSize = data?.meta.page_size ?? 20
  const totalPages = totals
    ? kind === 'resources'
      ? Math.ceil(totals.resources / pageSize)
      : kind === 'topics'
        ? Math.ceil(totals.topics / pageSize)
        : kind === 'people'
          ? Math.ceil(totals.people / pageSize)
          : kind === 'tags'
            ? Math.ceil(totals.tags / pageSize)
            : 0
    : 0

  const tabs: Array<{ key: SearchKind; label: string; count?: number }> = [
    { key: 'all', label: '全部' },
    { key: 'resources', label: '作品', count: totals?.resources },
    { key: 'topics', label: '主题帖', count: totals?.topics },
    { key: 'people', label: '成员', count: totals?.people },
    { key: 'tags', label: '标签', count: totals?.tags },
  ]

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-6">
      <PageHeader
        title="检索"
        description="作品、帖子、成员、标签，分成四类摆开。先看哪一类，再往下翻。"
      />

      <form onSubmit={submit} className="relative" role="search">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="标题、作者、标签、成员，或正文里的半句话"
          aria-label="站内检索词"
          className="h-11 pl-9 pr-20"
        />
        <Button type="submit" size="sm" className="absolute right-1.5 top-1/2 -translate-y-1/2">
          检索
        </Button>
      </form>

      {!q ? (
        <EmptyState
          title="输入一个词，四类结果一起出现"
          description="不用先选去内容库还是论坛。搜作者名会看到人和作品，搜标签会看到同题内容。"
        />
      ) : query.isPending ? (
        <Loading />
      ) : query.isError || !data || !totals ? (
        <ErrorState message="检索结果没加载出来" onRetry={() => void query.refetch()} />
      ) : (
        <>
          <div className="flex gap-1 overflow-x-auto border-b pb-2" role="tablist">
            {tabs.map((tab) => {
              const active = kind === tab.key
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => go(tab.key)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
                    active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {tab.label}
                  {typeof tab.count === 'number' ? (
                    <span className={`font-mono text-[10px] ${active ? 'text-primary-foreground/70' : 'text-muted-foreground/70'}`}>
                      {compact(tab.count)}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          {kind === 'all' ? (
            <div className="space-y-9">
              {totals.resources > 0 ? (
                <section className="space-y-1">
                  <SectionHead title="作品" count={totals.resources} onMore={() => go('resources')} />
                  <div className="divide-y">
                    {data.resources.map((row) => (
                      <ResourceResult key={row.id} row={row} query={q} />
                    ))}
                  </div>
                </section>
              ) : null}

              {totals.topics > 0 ? (
                <section className="space-y-3">
                  <SectionHead title="主题帖" count={totals.topics} onMore={() => go('topics')} />
                  <div className="space-y-3">
                    {data.topics.map((row) => (
                      <TopicResult key={row.id} row={row} query={q} />
                    ))}
                  </div>
                </section>
              ) : null}

              {totals.people > 0 ? (
                <section className="space-y-3">
                  <SectionHead title="成员" count={totals.people} onMore={() => go('people')} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {data.people.map((row) => (
                      <PersonResult key={row.username} row={row} />
                    ))}
                  </div>
                </section>
              ) : null}

              {totals.tags > 0 ? (
                <section className="space-y-3">
                  <SectionHead title="标签" count={totals.tags} onMore={() => go('tags')} />
                  <div className="flex flex-wrap gap-2">
                    {data.tags.map((row) => (
                      <TagResult key={row.name} row={row} />
                    ))}
                  </div>
                </section>
              ) : null}

              {totals.resources + totals.topics + totals.people + totals.tags === 0 ? (
                <div className="space-y-3">
                  <EmptyState
                    title={`没有找到「${q}」`}
                    description="可以缩短关键词、换一个作者名，或者直接去内容库按方向和年份浏览。"
                  />
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/catalog">去内容库</Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/forum">去主题论坛</Link>
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              {kind === 'resources' ? (
                data.resources.length ? (
                  <div className="divide-y">
                    {data.resources.map((row) => (
                      <ResourceResult key={row.id} row={row} query={q} />
                    ))}
                  </div>
                ) : (
                  <NoKindResult kind="作品" q={q} fallback="/catalog" fallbackLabel="去内容库" />
                )
              ) : null}

              {kind === 'topics' ? (
                data.topics.length ? (
                  <div className="space-y-3">
                    {data.topics.map((row) => (
                      <TopicResult key={row.id} row={row} query={q} />
                    ))}
                  </div>
                ) : (
                  <NoKindResult kind="主题帖" q={q} fallback="/forum" fallbackLabel="去主题论坛" />
                )
              ) : null}

              {kind === 'people' ? (
                data.people.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {data.people.map((row) => (
                      <PersonResult key={row.username} row={row} />
                    ))}
                  </div>
                ) : (
                  <NoKindResult kind="成员" q={q} fallback="/explore" fallbackLabel="去发现页" />
                )
              ) : null}

              {kind === 'tags' ? (
                data.tags.length ? (
                  <div className="flex flex-wrap gap-2">
                    {data.tags.map((row) => (
                      <TagResult key={row.name} row={row} />
                    ))}
                  </div>
                ) : (
                  <NoKindResult kind="标签" q={q} fallback="/tags" fallbackLabel="浏览全部标签" />
                )
              ) : null}

              {totalPages > 1 ? (
                <Pagination page={page} totalPages={totalPages} onPageChange={(next) => go(kind, next)} />
              ) : null}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              作品按标题、摘要、作者与标签匹配，标题命中排在前面；主题帖只搜标题和正文；成员只展示公开资料。
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function NoKindResult({
  kind,
  q,
  fallback,
  fallbackLabel,
}: {
  kind: string
  q: string
  fallback: '/catalog' | '/forum' | '/explore' | '/tags'
  fallbackLabel: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-5 text-sm text-muted-foreground">
      <span>
        没有与「{q}」匹配的{kind}。
      </span>
      <Button variant="outline" size="sm" asChild>
        <Link to={fallback}>{fallbackLabel}</Link>
      </Button>
    </div>
  )
}
