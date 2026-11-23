import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowRight, ChevronDown, FileDown, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useCatalogStats, useResources } from '@/hooks/api/use-modules'
import type { ResourceType } from '@/lib/types'
import { formatAuthors, cn } from '@/lib/utils'
import { contentCategoryLabel, displayTypeLabel, isScholarlyContent, issueShortLabel } from '@/lib/resource-labels'
import { ESSAY_GENRES } from '@/lib/essay-genres'
import { ARTICLE_SECTION_OPTIONS } from '@/lib/article-sections'
import { PageHeader } from '@/components/common/page-header'
import { ScrollCue } from '@/components/common/scroll-cue'
import { EmptyState, ErrorState } from '@/components/common/state'
import { Pagination } from '@/components/common/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { CatalogIndexRow } from './-catalog-index-row'
import { ContentSpectrum } from '@/components/catalog/content-spectrum'
import { FunCatalog } from '@/components/catalog/fun-feed'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const Route = createFileRoute('/catalog/')({
  component: CatalogListPage,
})

interface CatalogSearch {
  q?: string
  type?: ResourceType
  category?: 'academic' | 'fun' | 'rant' | 'essay'
  /** 轨道切换：paper=研究长文，essay=自由创作。
   *  不写 = 全部。URL 持久化，刷新不丢。 */
  track?: 'paper' | 'essay'
  /** 作品子类型：serious=实证研究 / absurd=荒诞写作。 */
  kind?: 'serious' | 'absurd'
  /** 娱乐轨文体（v1.16）：只在 track=essay 时生效 */
  genre?: 'joke' | 'fiction' | 'review' | 'guide' | 'essay' | 'poetry' | 'rant'
  discipline?: string
  year?: number
  year_from?: number
  year_to?: number
  author?: string
  doi?: string
  clc?: string
  /** 话题分区 slug（article_section）。 */
  section?: string
  /** 合集分组（旧 volume 字段，仅兼容数据）。 */
  volume?: string
  /** 合集编号（旧 issue 字段，仅兼容数据）。 */
  issue?: string
  /** 旧目录字段：合集 ID。 */
  issue_id?: number
  /** 目录排序；random=随机，issue=合集顺序，latest=最近更新。 */
  sort?: 'issue' | 'random' | 'latest'
  page?: number
  view?: 'list' | 'index'
}

// 档案只分“研究 / 创作”，不承载旧报刊分期与分区叙事。
const TYPE_OPTIONS: { value: ResourceType | 'all'; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'paper', label: '写作' },
  { value: 'book', label: '图书' },
  { value: 'dataset', label: '数据集' },
  { value: 'tutorial', label: '自由创作' },
]


export function CatalogListPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as CatalogSearch

  // 轨道切换 → 后端 ?track=paper|essay（按 content_track 过滤，与旧 content_category 解耦）。
  // 目录是唯一入口；只有 kind 没有 track 时，按写作处理。
  const effectiveTrack: 'paper' | 'essay' | undefined =
    search.track ?? (search.kind ? 'paper' : undefined)
  // 档案内默认进入「研究长文」；荒诞写作是同页的并列分区。
  const paperKind: 'serious' | 'absurd' = search.kind ?? 'serious'
  const statsTrack = effectiveTrack === 'essay' ? 'essay' : effectiveTrack === 'paper' ? 'paper' : undefined

  // 目录首页采用「可复现随机」：每次进入/点“换一批”换 seed，分页仍稳定；
  // 搜索时回到相关度/新近排序，避免随机打乱检索结果。
  const [feedSeed, setFeedSeed] = useState(() => Math.floor(Math.random() * 2147483646) + 1)
  const randomFeed =
    Boolean(search.track || search.kind) &&
    !search.q &&
    !search.author &&
    search.sort !== 'latest' &&
    search.sort !== 'issue'

  const params = {
    q: search.q || undefined,
    type: search.type,
    category: search.category || undefined,
    // 搜索结果页的文案是“全站写作与自由创作”，所以有搜索词时必须解除当前分区
    // 的 track/paper_kind 收窄；否则已改判荒诞、或被分到自由创作的稿在目录检索下会假性 0 命中。
    track: search.q ? undefined : effectiveTrack,
    paper_kind: search.q || search.volume ? undefined : effectiveTrack === 'paper' ? paperKind : undefined,
    genre: effectiveTrack === 'essay' ? search.genre : undefined,
    discipline: search.discipline || undefined,
    year: search.year,
    year_from: search.year_from,
    year_to: search.year_to,
    author: search.author || undefined,
    doi: search.doi || undefined,
    clc: search.clc || undefined,
    section: search.section || undefined,
    volume: search.volume || undefined,
    issue: search.volume ? search.issue || undefined : undefined,
    issue_id: search.issue_id,
    page: search.page || 1,
    page_size: 10,
    sort:
      search.sort === 'latest'
        ? ('created_at' as const)
        : search.sort === 'random'
          ? ('random' as const)
          : search.sort === 'issue'
            ? ('issue' as const)
            : randomFeed
              ? ('random' as const)
              : undefined,
    seed: randomFeed ? feedSeed : undefined,
  }

  const { data, isLoading, isError, refetch } = useResources(params)
  const { data: stats } = useCatalogStats(statsTrack)

  const seriousCount = stats?.by_paper_kind?.serious
  const absurdCount = stats?.by_paper_kind?.absurd

  // 默认索引行，不默认九宫格：卡片只作为用户主动切换的展示方式。
  const viewMode: 'list' | 'index' = search.view === 'list' ? 'list' : 'index'

  // 筛选条件写到 URL，replace 避免每次筛选都污染历史。
  const updateSearch = (patch: Partial<CatalogSearch>) => {
    void navigate({
      to: '/catalog',
      search: { ...search, ...patch },
      replace: true,
    } as never)
  }

  const shuffleFeed = () => {
    setFeedSeed(Math.floor(Math.random() * 2147483646) + 1)
    updateSearch({ page: 1, sort: 'random' })
  }

  if (effectiveTrack === 'essay') {
    return (
      <FunCatalog
        data={data}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        stats={stats}
        search={search}
        updateSearch={updateSearch}
        onShuffle={shuffleFeed}
      />
    )
  }

  // 总目录不把内容混成一列：先选「研究长文 / 自由创作」，
  // 档案里再选「实证 / 荒诞」。
  const hasCatalogFilter = Boolean(
    search.q || search.type || search.category || search.discipline || search.year || search.kind || search.volume || search.issue,
  )
  if (!effectiveTrack && !hasCatalogFilter) {
    return <CatalogHub />
  }

  const isCover =
    effectiveTrack === 'paper' &&
    !search.q &&
    !search.discipline &&
    !search.year &&
    !search.volume &&
    !search.issue &&
    !search.type &&
    !search.category

  return (
    <div>
      <section className={cn('flex flex-col', isCover && 'min-h-[calc(100svh-5rem)]')}>
      <div className={cn(isCover && 'flex flex-1 flex-col justify-center')}>
      {!search.q && effectiveTrack === 'paper' && (
        <p className="mb-2 text-center text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
          {search.issue ? `合集 ${String(search.issue).padStart(2, '0')}` : 'ARCHIVE'}
        </p>
      )}
      <PageHeader
        title={
          search.q
            ? '搜索结果'
            : search.volume
              ? search.issue
                ? `合集 ${String(search.issue).padStart(2, '0')}`
                : `合集 ${String(search.volume).padStart(2, '0')}`
              : effectiveTrack === 'paper'
                ? '研究长文'
                : effectiveTrack === 'essay'
                  ? '自由创作'
                  : '全部文字'
        }
        size={!search.q && effectiveTrack === 'paper' ? 'cover' : 'default'}
        description={
          search.q
            ? `在全站公开文字中检索“${search.q}”，命中 ${data?.meta.total ?? '…'} 条。`
            : search.volume
              ? `${search.issue ? `合集 ${String(search.issue).padStart(2, '0')}` : `合集 ${String(search.volume).padStart(2, '0')}`}共 ${data?.meta.total ?? '…'} 篇作品，按发布顺序排列。`
              : effectiveTrack === 'paper'
                ? '把真问题做清楚，也允许把荒唐的设定做完整。材料、过程与结论都留在纸面上；各读各的，不必互相假装。'
                : effectiveTrack === 'essay'
                  ? '小说、随笔、评论、指南与吐槽。无须借研究的骨架，文字自己走路。'
                  : '按条件筛出的全部作品；研究长文与自由创作都在这里，先看标题和开头。'
        }
      />

      {/* 档案目录：一级是“实证 / 荒诞”，二级是研究方向。先看目录，再看记录。 */}
      {effectiveTrack === 'paper' && !search.q ? (
        <ArchiveDirectory
          paperKind={paperKind}
          seriousCount={seriousCount}
          absurdCount={absurdCount}
          updateSearch={updateSearch}
        />
      ) : null}

      </div>
      {isCover ? <ScrollCue label="往下翻" className="pb-36 sm:pb-10" /> : null}
      </section>

      {/* 筛选只露一层：搜索 + 话题；类型、分区、年份、作者收进“更多筛选”。 */}
      <Filters
        search={search}
        updateSearch={updateSearch}
        track={statsTrack}
        resultTotal={data?.meta.total}
        onShuffle={shuffleFeed}
        viewMode={viewMode}
        onViewChange={(view) => updateSearch({ view })}
      />

      {isLoading ? (
        <div className="space-y-3" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-4 w-32 sm:block" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="hidden h-4 w-24 md:block" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="加载资源失败" onRetry={() => refetch()} />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          title={search.q ? '没有找到匹配的内容' : '这里还空着'}
          description={
            search.q
              ? '换个更短的关键词，或清除搜索回到全部作品；也可以按卷顺着读。'
              : effectiveTrack === 'paper'
                ? '换个话题或分区看看，也可以按卷顺着读。'
                : '还没有匹配的自由创作，换个文体或关键词试试。'
          }
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/issues">
                按卷浏览
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          }
        />
      ) : viewMode === 'index' ? (
        // 默认索引：手机一栏，桌面两栏；没有封面、没有卡片，标题和开头先读。
        <div className="grid border-t sm:grid-cols-2 sm:gap-x-12" data-testid="catalog-resource-list">
          {data.data.map((r, index) => (
            <div key={r.id} className="border-b">
              <CatalogIndexRow resource={r} query={search.q} index={index + 1} />
            </div>
          ))}
        </div>
      ) : (
        // 桌面端：表格
        <Card>
          <CardContent className="p-0">
            {/* 平板宽度下必须 table-fixed：auto 布局会用 min-content 撑宽，
                truncate/max-w 全部失效，整表又被裁掉。桌面恢复 auto。 */}
            <Table className="table-fixed lg:table-auto">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[45%] lg:w-auto">标题</TableHead>
                  <TableHead className="w-[30%] lg:w-auto">作者</TableHead>
                  {/* 平板（768–1023）放不下 6 列：年份/研究方向先让位，
                      否则整表被裁成「标题 + 作者」两列，读者以为坏了。 */}
                  <TableHead className="hidden w-16 lg:table-cell">年份</TableHead>
                  <TableHead className="hidden lg:table-cell">话题</TableHead>
                  <TableHead className="w-20">类型</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((r) => {
                  const authors = formatAuthors(r.authors)
                  return (
                    <TableRow key={r.id}>
                      {/* 长文本列约束列宽 + 截断，防止 160 字符标题把整表撑出视口
                          （对齐 shadcn DataTable 长文本列 max-w+truncate 惯例） */}
                      <TableCell className="max-w-[320px] truncate">
                        <Link
                          to="/catalog/$resourceId"
                          params={{ resourceId: String(r.id) }}
                          className="font-medium hover:text-primary"
                        >
                          {r.short_title?.trim() || r.title}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate text-muted-foreground">
                        {authors}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{r.year}</TableCell>
                      <TableCell className="hidden max-w-[200px] truncate lg:table-cell">
                        {r.discipline}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {issueShortLabel(r.issue) ? (
                            <Badge variant="outline" className="text-[10px] border-border/80">
                              {issueShortLabel(r.issue)}
                            </Badge>
                          ) : null}
                          <Badge variant="secondary">{displayTypeLabel(r.type, r.content_category, r.content_track, r.track)}</Badge>
                         {isScholarlyContent(r.content_category, r.content_track) && r.content_category ? (
                            <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/25">
                              {contentCategoryLabel(r.content_category)}
                            </Badge>
                          ) : null}
                          {r.has_file ? (
                            <span
                              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"
                              title="提供 PDF 全文"
                            >
                              <FileDown className="h-3 w-3" />
                              PDF
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data && (
        <Pagination
          page={data.meta.page}
          totalPages={data.meta.total_pages}
          onPageChange={(p) => updateSearch({ page: p })}
        />
      )}

    </div>
  )
}

// 总目录落地页：不把研究/创作做成两张“门户卡”。
// 用一个整理目录：先研究长文（实证 / 荒诞两行），再自由创作（文体一行）。
function CatalogHub() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const { data: stats, isLoading: statsLoading } = useCatalogStats()
  const { data: latest, isLoading: latestLoading } = useResources({
    page: 1,
    page_size: 6,
    sort: 'created_at',
    order: 'desc',
  })
  const seriousTotal = stats ? stats.by_paper_kind?.serious ?? 0 : undefined
  const absurdTotal = stats ? stats.by_paper_kind?.absurd ?? 0 : undefined
  const paperTotal = seriousTotal == null || absurdTotal == null ? undefined : seriousTotal + absurdTotal
  const genreCounts = stats?.by_genre ?? {}
  const essayTotal = stats
    ? stats.by_track?.essay ?? Object.values(genreCounts).reduce((a, b) => a + b, 0)
    : undefined
  const genres = ESSAY_GENRES.filter((g) => (genreCounts[g.value] ?? 0) > 0)

  const rowClass =
    'group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-5 transition-colors hover:text-primary'

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <PageHeader
        title="内容库"
        description="长文、怪问题、小说与随笔都在这里。按卷慢慢读；想发短帖去讨论区，想写长文去发布作品。"
        actions={
          <Button asChild variant="outline">
            <Link to="/issues">按卷浏览</Link>
          </Button>
        }
      />

      <form
        className="mt-8 flex w-full max-w-2xl gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const q = query.trim()
          void navigate({ to: '/catalog', search: q ? { q } : {} })
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜内容、作者、话题"
          aria-label="搜索内容"
          className="h-11"
        />
        <Button type="submit" className="h-11 shrink-0 px-5">
          搜索
        </Button>
      </form>

      {latestLoading ? (
        <section className="mt-8 border-y py-6" aria-hidden>
          <div className="divide-y">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-4 py-5">
                <Skeleton className="h-4 w-8 shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : latest?.data?.length ? (
        <section className="mt-8 border-y py-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl font-semibold tracking-tight">刚刚放上桌</h2>
              <p className="mt-1 text-sm text-muted-foreground">最近公开的六篇。先读一两篇，再决定往哪走。</p>
            </div>
            <Link to="/catalog" search={{ sort: 'latest' }} className="text-sm text-primary hover:underline">
              全部文字 →
            </Link>
          </div>
          <div className="mt-2 grid border-t sm:grid-cols-2 sm:gap-x-12">
            {latest.data.map((item, index) => (
              <div key={item.id} className="border-b">
                <CatalogIndexRow resource={item} index={index + 1} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {statsLoading ? <ContentSpectrumSkeleton /> : <ContentSpectrum stats={stats} />}

      <section className="mt-10 border-t pt-7">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">01 · 先把事说清</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight">研究长文</h2>
          </div>
          <p className="font-mono text-sm tabular-nums text-muted-foreground">
            {paperTotal ?? '…'} 篇
          </p>
        </div>

        <div className="mt-6 divide-y border-y">
          <Link to="/catalog" search={{ kind: 'serious' }} className={rowClass}>
            <span className="font-mono text-xs text-muted-foreground">01</span>
            <span className="min-w-0">
              <span className="block font-serif text-xl font-semibold">实证研究</span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                真实问题、能核对的材料、完整的过程。先把事情说清，再谈写得漂不漂亮。
              </span>
            </span>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {seriousTotal ?? '…'} 篇 →
            </span>
          </Link>

          <Link to="/catalog" search={{ kind: 'absurd' }} className={rowClass}>
            <span className="font-mono text-xs text-absurd">02</span>
            <span className="min-w-0">
              <span className="block font-serif text-xl font-semibold">荒诞写作</span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                一本正经地写不可能的事。设定要立住，推理要能跟上。
              </span>
            </span>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {absurdTotal ?? '…'} 篇 →
            </span>
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/catalog" search={{ track: 'paper', sort: 'latest' }} className="text-primary hover:underline">
            最新公开 →
          </Link>
          <Link to="/catalog" search={{ track: 'paper' }} className="text-muted-foreground hover:text-primary">
            全部研究
          </Link>
        </div>
      </section>

      <section className="mt-12 border-t pt-7">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">02 · 想怎么写就怎么写</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight">自由创作</h2>
          </div>
          <Link to="/catalog" search={{ track: 'essay', sort: 'latest' }} className="text-sm text-primary hover:underline">
            最新创作 →
          </Link>
        </div>

        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
          {essayTotal ?? '…'} 篇 · 小说、随笔、评论、指南、吐槽；不套研究格式，也不计分。
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/catalog" search={{ track: 'essay' }} className="text-muted-foreground hover:text-primary">
            全部创作
          </Link>
        </div>

        {genres.length > 0 && (
          <div className="mt-5">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-xs font-medium text-muted-foreground">按文体进入</p>
              <Link to="/catalog" search={{ track: 'essay' }} className="text-[11px] text-primary hover:underline">
                全部文体
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {genres.map((g) => (
                <Link
                  key={g.value}
                  to="/catalog"
                  search={{ track: 'essay', genre: g.value }}
                  className="inline-flex items-baseline gap-1.5 text-sm transition-colors hover:text-primary"
                >
                  <span>{g.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {genreCounts[g.value] ?? 0}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        <p className="mt-8 border-t pt-4 text-[11px] leading-6 text-muted-foreground">
          自由创作不计分，也不进热度；推荐按文体来。
        </p>
      </section>
    </div>
  )
}

// 内容地图骨架：统计接口返回前先占住与最终区块接近的高度，
// 避免数据到达后整段插入、把下面的研究长文/自由创作两节往下推（CLS）。
function ContentSpectrumSkeleton() {
  return (
    <section className="mt-10 border-y py-8" aria-hidden>
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-6 w-72 max-w-full" />
      </div>
      <Skeleton className="mt-6 h-3 w-full rounded-full" />
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-20" />
        ))}
      </div>
      <div className="mt-7 grid gap-x-10 gap-y-3 sm:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </section>
  )
}

function ViewSwitcher({
  value,
  onChange,
}: {
  value: 'list' | 'index'
  onChange: (view: 'list' | 'index') => void
}) {
  return (
    <div
      className="inline-flex rounded-lg border p-0.5 text-sm"
      role="group"
      aria-label="切换视图"
    >
      {(['index', 'list'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'rounded-md px-3.5 py-1.5 transition-colors',
            value === v
              ? 'bg-primary font-medium text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {v === 'index' ? '索引' : '列表'}
        </button>
      ))}
    </div>
  )
}

// 目录搜索：350ms 防抖的「输入即搜」，回车立即提交。
// 为什么防抖而不是每次击键都发请求：目录查询是聚合接口，逐键请求
// 会放大后端压力；比回车触发多的价值是无需学习成本的即时反馈。
function DebouncedSearchInput({
  initial,
  onCommit,
}: {
  initial: string
  onCommit: (q: string) => void
}) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    setValue(initial)
  }, [initial])
  useEffect(() => {
    if (value === initial) return
    const timer = setTimeout(() => onCommit(value), 350)
    return () => clearTimeout(timer)
  }, [value, initial, onCommit])
  return (
    <Input
      placeholder="标题/作者/开头"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value)
      }}
    />
  )
}
// 筛选只露一层：搜索 + 话题快捷筛选；类型、分区、年份、作者收进“更多筛选”。
function Filters({
  search,
  updateSearch,
  track,
  resultTotal,
  onShuffle,
  viewMode,
  onViewChange,
}: {
  search: CatalogSearch
  updateSearch: (patch: Partial<CatalogSearch>) => void
  track?: 'paper' | 'essay'
  resultTotal?: number
  onShuffle?: () => void
  viewMode: 'list' | 'index'
  onViewChange: (view: 'list' | 'index') => void
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const advancedActive = [
    search.type,
    search.section,
    search.year,
    search.year_from,
    search.year_to,
    search.author,
  ].filter(Boolean).length

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <DebouncedSearchInput
            initial={search.q ?? ''}
            onCommit={(q) => updateSearch({ q: q || undefined, page: 1 })}
          />
        </div>
        <Button
          type="button"
          variant={search.sort === 'latest' ? 'default' : 'outline'}
          size="sm"
          className="h-9 shrink-0 px-3 text-xs"
          onClick={() => updateSearch({ sort: 'latest', page: 1 })}
          aria-label="按最近更新排序"
        >
          最新
        </Button>
        {onShuffle && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0 gap-1 px-3 text-xs"
            onClick={onShuffle}
            aria-label="随机换一批"
            title="随机换一批"
          >
            <RefreshCw className="h-4 w-4" />
            换一批
          </Button>
        )}
        <ViewSwitcher value={viewMode} onChange={onViewChange} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="relative h-9 shrink-0 gap-1.5 px-3 text-xs"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
        >
          <SlidersHorizontal className="h-4 w-4" />
          更多筛选
          {advancedActive > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
              {advancedActive}
            </span>
          )}
        </Button>
      </div>

      <DisciplineChips search={search} updateSearch={updateSearch} track={track} resultTotal={resultTotal} />

      {advancedOpen && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <AdvancedFilters search={search} updateSearch={updateSearch} />
        </div>
      )}
    </div>
  )
}

// 高级筛选：默认收起，避免打开页面先看到一面筛选墙。
function AdvancedFilters({
  search,
  updateSearch,
}: {
  search: CatalogSearch
  updateSearch: (patch: Partial<CatalogSearch>) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">类型</label>
        <Select
          value={search.type ?? 'all'}
          onValueChange={(v) =>
            updateSearch({
              type: v === 'all' ? undefined : (v as ResourceType),
              page: 1,
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">分区</label>
        <Select
          value={search.section ?? 'all'}
          onValueChange={(v) =>
            updateSearch({ section: v === 'all' ? undefined : v, page: 1 })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分区</SelectItem>
            {ARTICLE_SECTION_OPTIONS.map((section) => (
              <SelectItem key={section.value} value={section.value}>
                {section.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">年份区间</label>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="起"
            defaultValue={search.year_from ?? ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = (e.target as HTMLInputElement).value
                updateSearch({ year_from: v ? Number(v) : undefined, page: 1 })
              }
            }}
          />
          <span className="text-xs text-muted-foreground">—</span>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="止"
            defaultValue={search.year_to ?? ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = (e.target as HTMLInputElement).value
                updateSearch({ year_to: v ? Number(v) : undefined, page: 1 })
              }
            }}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">作者</label>
        <Input
          placeholder="如 张 / Smith"
          defaultValue={search.author ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value.trim()
              updateSearch({ author: v || undefined, page: 1 })
            }
          }}
        />
      </div>
    </div>
  )
}

// 话题快捷筛选，
// 带篇数计数，点击即筛。超过 8 个时默认收起一排展开按钮 ——
// 已选中的话题即使排在收起区也会补显出来，不让筛选条件"隐身"。
const CHIP_COLLAPSE_AT = 8

function ArchiveDirectory({
  paperKind,
  seriousCount,
  absurdCount,
  updateSearch,
}: {
  paperKind: 'serious' | 'absurd'
  seriousCount?: number
  absurdCount?: number
  updateSearch: (patch: Partial<CatalogSearch>) => void
}) {
  const kinds = [
    {
      id: 'serious' as const,
      label: '实证研究',
      note: '真实问题 · 可核查材料 · 完整过程',
      count: seriousCount,
      activeClass: 'border-primary text-primary',
    },
    {
      id: 'absurd' as const,
      label: '荒诞写作',
      note: '设定清楚 · 推理完整 · 结论可以离谱',
      count: absurdCount,
      activeClass: 'border-absurd text-absurd',
    },
  ]
  const activeKind = kinds.find((kind) => kind.id === paperKind) ?? kinds[0]

  return (
    <section className="mb-8 border-y" aria-label="内容库">
      <div className="flex flex-wrap items-baseline gap-x-10 gap-y-2 py-5" role="tablist" aria-label="作品分区">
        {kinds.map((kind) => {
          const active = paperKind === kind.id
          return (
            <button
              key={kind.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => updateSearch({ kind: kind.id, discipline: undefined, page: 1 })}
              className={cn(
                'inline-flex items-baseline gap-2 border-b-2 pb-1 text-left transition-colors',
                active
                  ? kind.activeClass
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="font-serif text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
                {kind.label}
              </span>
              <span className="font-mono text-sm tabular-nums">{kind.count ?? '…'} 篇</span>
            </button>
          )
        })}
      </div>
      <p className="pb-4 text-sm leading-6 text-muted-foreground">{activeKind.note}</p>
    </section>
  )
}

function DisciplineChips({
  search,
  updateSearch,
  track,
  resultTotal,
}: {
  search: CatalogSearch
  updateSearch: (patch: Partial<CatalogSearch>) => void
  track?: 'paper' | 'essay'
  resultTotal?: number
}) {
  const { data: stats } = useCatalogStats(track)
  const [expanded, setExpanded] = useState(false)
  const disciplines = useMemo(
    () => Object.entries(stats?.by_discipline ?? {}).sort((a, b) => b[1] - a[1]),
    [stats],
  )
  // 搜索态下研究方向 chip 的计数是“全站存量”，与命中数无关，
  // 继续展示会让人以为“心理学 38 条”就是搜索结果。这里换成结果概览。
  if (search.q) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="搜索结果概览">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground">
          结果
          <span className="tabular-nums">{resultTotal ?? 0}</span>
        </span>
        <button
          type="button"
          onClick={() => updateSearch({ q: undefined, page: 1 })}
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          清除搜索
        </button>
      </div>
    )
  }

  if (disciplines.length === 0) return null

  const collapsed = !expanded && disciplines.length > CHIP_COLLAPSE_AT
  const visible = collapsed ? disciplines.slice(0, CHIP_COLLAPSE_AT) : [...disciplines]
  if (collapsed && search.discipline) {
    const idx = disciplines.findIndex(([name]) => name === search.discipline)
    if (idx >= CHIP_COLLAPSE_AT) visible.push(disciplines[idx])
  }
  const hiddenCount = Math.max(0, disciplines.length - visible.length)

  const chipCls = (active: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
      active
        ? 'border-primary bg-primary text-primary-foreground'
        : 'bg-card text-foreground/80 hover:border-primary/40 hover:text-foreground',
    )

  return (
    <>
    <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="按话题快速筛选">
      <button
        type="button"
        className={chipCls(!search.discipline)}
        onClick={() => updateSearch({ discipline: undefined, page: 1 })}
      >
        '全部'
        <span className="tabular-nums opacity-60">{stats?.total ?? '…'}</span>
      </button>
      {visible.map(([name, count]) => (
        <button
          key={name}
          type="button"
          className={chipCls(search.discipline === name)}
          onClick={() => updateSearch({ discipline: name, page: 1 })}
        >
          {name}
          <span className="tabular-nums opacity-60">{count}</span>
        </button>
      ))}
      {collapsed && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          aria-expanded={false}
        >
          更多 {hiddenCount} 个话题
          <ChevronDown className="h-3 w-3" />
        </button>
      )}
      {expanded && disciplines.length > CHIP_COLLAPSE_AT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          aria-expanded
        >
          收起
          <ChevronDown className="h-3 w-3 rotate-180" />
        </button>
      )}
    </div>
    </>
  )
}
