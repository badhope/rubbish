import { Link } from '@tanstack/react-router'
import { ArrowRight, ChevronDown, RefreshCw, Search, Sparkles } from 'lucide-react'
import type { ResourceResponse, ResourceStats } from '@/lib/types'
import { ESSAY_GENRES, essayGenreMeta } from '@/lib/essay-genres'
import { ArticleCover } from '@/components/common/article-cover'
import { formatAuthors, cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState } from '@/components/common/state'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollCue } from '@/components/common/scroll-cue'

// 娱乐区（v1.16）：不是“论文目录换个底色”，而是一套自己的阅读入口。
// 论文区回答“这篇文章可不可信”；娱乐区回答“这篇东西好不好玩”。
// 因此这里不出现学科、CLC、评分、PDF 徽章，只用文体 + 作者 + 阅读量。

interface FunCatalogProps {
  data?: { data: ResourceResponse[]; meta: { page: number; total_pages: number; total: number } }
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  stats?: ResourceStats
  search: { q?: string; genre?: string; page?: number }
  updateSearch: (patch: Record<string, unknown>) => void
  routePath: '/papers' | '/fun' | '/catalog'
  onShuffle?: () => void
}

function plainPreview(text?: string | null): string {
  return (text ?? '')
    .replace(/[#>*_`~]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
}

export function FunCatalog({
  data,
  isLoading,
  isError,
  onRetry,
  stats,
  search,
  updateSearch,
  routePath,
  onShuffle,
}: FunCatalogProps) {
  const genreCounts = stats?.by_genre ?? {}
  const visibleGenres = ESSAY_GENRES.filter((g) => (genreCounts[g.value] ?? 0) > 0)
  // 「全部」用全站聚合总数，不能把各文体相加：没有文体的公告/说明会漏掉，
  // 出现「全部 35、页脚 36」的自相矛盾。
  const totalAll = stats?.total ?? data?.meta.total ?? null

  const go = (patch: Record<string, unknown>) => {
    updateSearch({ ...patch, page: 1 })
  }

  // 编辑部栏目说明不跟普通副刊稿抢头图：抽成顶部一条紧凑说明栏，
  // 首篇推荐也只从真正的副刊稿里选，避免推荐永远落在公告上；顺序由随机目录决定。
  const editorialNotes = data?.data.filter(isEditorialNote) ?? []
  const stories = data?.data.filter((r) => !isEditorialNote(r)) ?? []
  const featuredId = stories[0]?.id
  const rest = stories.slice(1)

  return (
    <div className="w-full">
      {/* 第一屏只回答“这是副刊、怎么搜、有哪些文体”，不往下露推荐和列表。 */}
      <section className="mx-auto flex min-h-[100svh] w-full max-w-[1320px] flex-col justify-start px-0 pb-24 pt-10 sm:pt-16">
      <header className="relative border-t pt-6 sm:pt-8">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/70 sm:block sm:text-[11px] sm:tracking-[0.24em]">
              Rubbish · Off the Record
            </p>
            <div className="inline-flex shrink-0 items-center rounded-full border border-border bg-card p-0.5 text-[11px]">
              <Link to="/papers" className="rounded-full px-2.5 py-0.5 text-muted-foreground hover:text-foreground">
                论文
              </Link>
              <span className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-primary-foreground">副刊</span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
            <h1 className="section-title text-2xl font-semibold tracking-tight sm:text-4xl">
              副刊
            </h1>
            <span className="pb-0.5 text-xs text-muted-foreground sm:pb-1 sm:text-sm">
              不正经研究所，认真你就输了
            </span>
          </div>
          <p className="mt-1.5 hidden max-w-2xl text-sm leading-6 text-muted-foreground sm:mt-2 sm:block sm:leading-7">
            小说、随笔、评论、指南，以及大量假装是论文的整活。这里不计分、不进站内热度、
            不走评审——只负责让你在改稿的间隙笑一下。
          </p>
        </div>
      </header>

      {/* 文体 + 搜索合并成一条工具栏；用上下细线分隔，不做第二张卡。 */}
      <div className="mt-5 border-y py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="hidden min-w-0 flex-1 flex-wrap gap-1.5 sm:flex">
            <GenrePill active={!search.genre} onClick={() => go({ genre: undefined })}>
              全部 · {totalAll ?? '…'}
            </GenrePill>
            {visibleGenres.map((g) => (
              <GenrePill
                key={g.value}
                active={search.genre === g.value}
                onClick={() => go({ genre: g.value })}
                title={g.hint}
              >
                {g.label} · {genreCounts[g.value]}
              </GenrePill>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              defaultValue={search.q ?? ''}
              placeholder="搜标题、作者，或者一个梗"
              className="h-10 rounded-full pl-9 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  go({ q: (e.target as HTMLInputElement).value.trim() || undefined })
                }
              }}
            />
          </div>
        </div>
        {/* 手机端文体入口放在第一屏，不再单独占一层；桌面端仍用顶部胶囊。 */}
        <div className="mt-2 flex flex-wrap gap-1.5 sm:hidden">
          <GenrePill active={!search.genre} onClick={() => go({ genre: undefined })}>
            全部 · {totalAll ?? '…'}
          </GenrePill>
          {visibleGenres.map((g) => (
            <GenrePill
              key={g.value}
              active={search.genre === g.value}
              onClick={() => go({ genre: search.genre === g.value ? undefined : g.value })}
              title={g.hint}
            >
              {g.emoji} {g.label} · {genreCounts[g.value]}
            </GenrePill>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <Link
            to="/policies"
            className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
          >
            格式与版式
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <div className="flex items-center gap-3">
            {onShuffle && (
              <button
                type="button"
                onClick={onShuffle}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                title="随机换一批"
              >
                <RefreshCw className="h-3 w-3" />
                换一批
              </button>
            )}
            <span>
              {search.genre ? `${essayGenreMeta(search.genre).label} · ` : ''}
              {data?.meta.total ?? '…'} 篇
            </span>
          </div>
        </div>
      </div>
      <ScrollCue label="向下浏览副刊" className="mt-16 pb-6 sm:mt-24 sm:pb-10" />
      </section>

      {isLoading ? (
        <div className="mt-4 border-t">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4 border-b py-4">
              <Skeleton className="h-20 w-20 shrink-0 rounded-md sm:h-24 sm:w-24" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3 rounded-sm" />
                <Skeleton className="h-3 w-1/3 rounded-sm" />
                <Skeleton className="h-3 w-full rounded-sm" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="mt-6">
          <ErrorState message="副刊没打开" onRetry={onRetry} />
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="这一栏还空着"
            description={
              search.genre
                ? '换个文体看看，或者直接把这篇稿子投过来。'
                : '还没有匹配的内容，换个关键词试试。'
            }
          />
        </div>
      ) : (
        <>
          {/* 公告默认折叠：它们重要，但不该和正文抢同一屏。 */}
          {editorialNotes.length > 0 && (
            <details className="group mt-3 hidden rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2 open:bg-muted/45 sm:block">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-medium text-foreground/80">
                <span>
                  公告与说明
                  <span className="ml-1 font-normal text-muted-foreground">· {editorialNotes.length} 条</span>
                </span>
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-2 grid gap-1.5 border-t border-border pt-2 sm:grid-cols-2">
                {editorialNotes.map((r) => (
                  <Link
                    key={r.id}
                    to="/catalog/$resourceId"
                    params={{ resourceId: String(r.id) }}
                    className="truncate text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {r.title}
                  </Link>
                ))}
                <Link
                  to="/sections"
                  className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline"
                >
                  全部栏目
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </details>
          )}

          <div className="w-full">
            {featuredId != null && (
              <section className="flex min-h-[100svh] flex-col justify-start border-b px-0 pb-24 pt-12 sm:pt-16">
                <div className="mx-auto w-full max-w-[1320px]">
                  <SectionHead title="本期推荐" note="每次刷新换一篇" />
                  <div className="mt-4">
                    <FunCard resource={stories[0]} featured />
                  </div>
                </div>
              </section>
            )}

            {rest.length > 0 && (
              <section className="flex min-h-[100svh] flex-col justify-start px-0 pb-24 pt-12 sm:pt-16">
                <div className="mx-auto w-full max-w-[1320px]">
                  <SectionHead
                    title="随机翻阅"
                    note={data.meta.total ? `共 ${data.meta.total} 篇 · 每次换一批` : undefined}
                  />
                  <div className="mt-4 grid grid-cols-1 gap-x-10 sm:grid-cols-2">
                    {rest.map((r) => (
                      <FunCard key={r.id} resource={r} featured={false} />
                    ))}
                  </div>
                </div>
              </section>
            )}

          </div>

          <div className="mx-auto mt-0 flex w-full max-w-[1320px] items-center justify-between gap-3 border-t border-border px-0 py-4">
            <Link
              to={routePath === '/fun' ? '/papers' : routePath}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              想看论文？去论文区
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Pagination
              page={data.meta.page}
              totalPages={data.meta.total_pages}
              onPageChange={(p) => updateSearch({ page: p })}
            />
          </div>
        </>
      )}
    </div>
  )
}

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
      <h2 className="font-serif text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
      {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
    </div>
  )
}

function GenrePill({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors sm:px-3 sm:py-1.5 sm:text-xs',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-card text-foreground/80 hover:border-primary/30 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function isEditorialNote(resource: ResourceResponse): boolean {
  const tags = (resource.tags ?? []).map(String)
  return formatAuthors(resource.authors) === 'Rubbish 编辑部' && (tags.includes('栏目说明') || tags.includes('编辑部'))
}

function FunCard({ resource, featured }: { resource: ResourceResponse; featured: boolean }) {
  const genre = essayGenreMeta(resource.content_genre)
  const preview = plainPreview(resource.preview || resource.abstract)

  if (featured) {
    return (
      <Link
        to="/catalog/$resourceId"
        params={{ resourceId: String(resource.id) }}
        className={cn(
          'group grid border-b pb-6',
          resource.cover_image
            ? 'grid-cols-[40%_1fr] md:grid-cols-[1.15fr_0.85fr]'
            : 'grid-cols-1',
        )}
      >
        <div className="order-2 flex flex-col justify-center gap-2 p-3 sm:gap-3 sm:p-7 md:order-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs">
            <span className="rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground sm:px-2.5 sm:py-1">
              {genre.label}
            </span>
            {resource.is_special_issue ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                长文
              </span>
            ) : null}
            <span className="text-muted-foreground">{resource.year}</span>
          </div>
          <h2 className="font-serif text-lg font-semibold leading-snug tracking-tight sm:text-2xl">
            {resource.title}
          </h2>
          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground sm:line-clamp-3 sm:text-sm sm:leading-7">{preview}</p>
          <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground sm:gap-x-3 sm:text-xs">
            <span>{formatAuthors(resource.authors) || '佚名'}</span>
            {resource.reads != null ? <span>· 阅读 {resource.reads}</span> : null}
            <span className="inline-flex items-center gap-1 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              本期推荐
            </span>
          </div>
        </div>
        <div
          className="relative order-1 min-h-[210px] overflow-hidden md:order-2 md:block md:min-h-[260px]"
        >
          <ArticleCover
            resource={resource}
            showDiscipline={false}
            aspect="aspect-auto h-full"
            className="h-full"
          />
          {!resource.cover_image ? (
            <span className="pointer-events-none absolute inset-0 grid place-items-center text-4xl">
              {genre.emoji}
            </span>
          ) : null}
        </div>
      </Link>
    )
  }

  return (
    <Link
      to="/catalog/$resourceId"
      params={{ resourceId: String(resource.id) }}
      className={cn(
        'group grid grid-cols-[96px_1fr] gap-4 border-b py-4 transition-colors hover:text-primary sm:grid-cols-[120px_1fr]',
        !resource.cover_image && 'fun-card-no-cover',
      )}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg sm:aspect-square sm:w-auto sm:rounded-xl">
        <ArticleCover resource={resource} showDiscipline={false} className="h-full" />
        {!resource.cover_image ? (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-2xl">
            {genre.emoji}
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground sm:gap-2 sm:text-[11px]">
          <span className="font-medium text-primary">{genre.label}</span>
          <span>·</span>
          <span>{resource.year}</span>
          {resource.reads != null ? <span>· 阅读 {resource.reads}</span> : null}
        </div>
        <h3 className="mt-1 line-clamp-2 font-serif text-[13px] font-semibold leading-snug tracking-tight sm:text-lg">
          {resource.title}
        </h3>
        <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-muted-foreground sm:mt-1.5 sm:line-clamp-2 sm:text-sm sm:leading-6">
          {preview}
        </p>
        <p className="mt-2 truncate text-[10px] text-muted-foreground sm:text-[11px]">
          {formatAuthors(resource.authors) || '佚名'}
        </p>
      </div>
    </Link>
  )
}
