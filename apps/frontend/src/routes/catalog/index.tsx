import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { AlertTriangle, ChevronDown, Download, FileDown, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { useIsMobile } from '@/hooks/use-is-mobile'
import {
  exportDocuments,
  exportPreflight,
  exportResources,
  useCatalogStats,
  useResources,
  type ExportPreflightResponse,
  type AnyExportFormat,
} from '@/hooks/api/use-modules'
import type { ResourceType } from '@/lib/types'
import { extractError, formatAuthors, cn } from '@/lib/utils'
import { contentCategoryLabel, displayTypeLabel, isScholarlyContent } from '@/lib/resource-labels'
import { ESSAY_GENRES } from '@/lib/essay-genres'
import { ARTICLE_SECTION_OPTIONS } from '@/lib/article-sections'
import { PageHeader } from '@/components/common/page-header'
import { ScrollCue } from '@/components/common/scroll-cue'
import { EmptyState, ErrorState } from '@/components/common/state'
import { Pagination } from '@/components/common/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { CatalogIndexRow } from './-catalog-index-row'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export const Route = createFileRoute('/catalog/')({
  component: CatalogListPage,
})

interface CatalogSearch {
  q?: string
  type?: ResourceType
  category?: 'academic' | 'fun' | 'rant' | 'essay'
  /** 轨道切换（v1.15）：paper=论文（学术），essay=娱乐（fun/rant 同属娱乐）。
   *  不写 = 全部。URL 持久化，刷新不丢。 */
  track?: 'paper' | 'essay'
  /** 论文子类型（/papers 内部分区）：serious=学术论文 / absurd=荒诞论文。 */
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
  /** 期刊栏目 slug（article_section）。 */
  section?: string
  /** 卷号；与 issue 一起用于按期筛选。 */
  volume?: string
  /** 期号；必须与 volume 一起使用。 */
  issue?: string
  /** 一期一等对象 ID；公开筛选优先用它。 */
  issue_id?: number
  /** 目录排序；issue=按卷期顺序。 */
  sort?: 'issue'
  page?: number
  view?: 'list' | 'index'
}

// 作品库只分“写作类型”，不承载期刊卷期与栏目叙事。
const TYPE_OPTIONS: { value: ResourceType | 'all'; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'paper', label: '写作' },
  { value: 'book', label: '图书' },
  { value: 'dataset', label: '数据集' },
  { value: 'tutorial', label: '教程' },
]

const EXPORT_FORMATS: { format: AnyExportFormat; label: string }[] = [
  { format: 'bibtex', label: 'BibTeX' },
  { format: 'ris', label: 'RIS' },
  { format: 'csv', label: 'CSV' },
  { format: 'json', label: 'JSON' },
  { format: 'jats', label: 'JATS' },
  { format: 'pdf', label: '合并 PDF（多篇）' },
  { format: 'docx', label: '合并 Word（多篇）' },
  { format: 'zip', label: '逐篇 ZIP' },
]

export function CatalogListPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as CatalogSearch
  const { isAuthenticated } = useAuth()
  const isMobile = useIsMobile()

  // 轨道切换 → 后端 ?track=paper|essay（按 content_track 过滤，与旧 content_category 解耦）。
  // 目录是唯一入口；只有 kind 没有 track 时，按写作处理。
  const effectiveTrack: 'paper' | 'essay' | undefined =
    search.track ?? (search.kind ? 'paper' : undefined)
  // 目录内默认进入「学术论文」；荒诞论文是同页的并列分区，不是另一条轨道。
  const paperKind: 'serious' | 'absurd' = search.kind ?? 'serious'
  const statsTrack = effectiveTrack === 'essay' ? 'essay' : effectiveTrack === 'paper' ? 'paper' : undefined

  // 目录首页采用「可复现随机」：每次进入/点“换一批”换 seed，分页仍稳定；
  // 搜索时回到相关度/新近排序，避免随机打乱检索结果。
  const [feedSeed, setFeedSeed] = useState(() => Math.floor(Math.random() * 2147483646) + 1)
  const randomFeed = Boolean(search.track || search.kind) && !search.q && !search.author && true

  const params = {
    q: search.q || undefined,
    type: search.type,
    category: search.category || undefined,
    // 搜索结果页的文案是“全站写作与自由创作”，所以有关键词时必须解除当前分区
    // 的 track/paper_kind 收窄；否则已改判荒诞、或被分到自由创作的稿在目录检索下会假性 0 命中。
    track: search.q ? undefined : effectiveTrack,
    paper_kind: search.q ? undefined : effectiveTrack === 'paper' ? paperKind : undefined,
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
    sort: search.sort === 'issue' ? ('issue' as const) : randomFeed ? ('random' as const) : undefined,
    seed: randomFeed ? feedSeed : undefined,
  }

  const { data, isLoading, isFetching, isError, refetch } = useResources(params)
  const { data: stats } = useCatalogStats(statsTrack)

  const seriousCount = stats?.by_paper_kind?.serious
  const absurdCount = stats?.by_paper_kind?.absurd

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  // 默认索引行，不默认九宫格：卡片只作为用户主动切换的展示方式。
  const viewMode: 'list' | 'index' = search.view === 'list' ? 'list' : 'index'

  // 筛选条件写到 URL，replace 避免每次筛选都污染历史。
  // 顺带清空勾选：翻页/改筛选后旧 id 已经不在页面上，留着会让「导出」
  // 把用户看不见的记录也一起导出去。
  const updateSearch = (patch: Partial<CatalogSearch>) => {
    setSelectedIds([])
    void navigate({
      to: '/catalog',
      search: { ...search, ...patch },
      replace: true,
    } as never)
  }

  const shuffleFeed = () => {
    setFeedSeed(Math.floor(Math.random() * 2147483646) + 1)
    updateSearch({ page: 1 })
  }

  const allIds = data?.data.map((r) => r.id) ?? []
  // 用「本页 id 是否都选中」判断，不能比长度：两页各有 10 条时
  // length 相等会让全选框误显示为已勾选。
  const allSelected = allIds.length > 0 && allIds.every((rid) => selectedIds.includes(rid))

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : allIds)
  }

  const toggleOne = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const [preflight, setPreflight] = useState<ExportPreflightResponse | null>(null)
  const [pendingFormat, setPendingFormat] = useState<AnyExportFormat | null>(null)

  const runExport = async (format: AnyExportFormat) => {
    try {
      if (format === 'pdf' || format === 'docx' || format === 'zip') {
        await exportDocuments(selectedIds, format)
      } else {
        await exportResources(selectedIds, format)
      }
      toast.success(`已导出 ${selectedIds.length} 条为 ${format.toUpperCase()}`)
    } catch (err) {
      toast.error(extractError(err, '导出失败'))
    }
  }

  const onExport = async (format: AnyExportFormat) => {
    if (selectedIds.length === 0) {
      toast.error('请先选择资源')
      return
    }
    try {
      const result = await exportPreflight(selectedIds)
      if (!result.can_export) {
        toast.error('所选资源都已删除或尚未公开，无法导出')
        return
      }
      if (result.warnings.length > 0 || result.missing_ids.length > 0) {
        setPreflight(result)
        setPendingFormat(format)
        return
      }
      await runExport(format)
    } catch (err) {
      toast.error(extractError(err, '导出前检查失败'))
    }
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

  // 总目录不再把所有内容混成一列：先让读者选「论文 / 自由创作」，
  // 论文里再选「学术 / 荒诞」。带检索词时仍走下面的跨区结果列表。
  const hasCatalogFilter = Boolean(
    search.q || search.type || search.category || search.discipline || search.year || search.kind,
  )
  if (!effectiveTrack && !hasCatalogFilter) {
    return <CatalogHub />
  }

  const isCover =
    effectiveTrack === 'paper' &&
    !search.q &&
    !search.discipline &&
    !search.year &&
    !search.type &&
    !search.category

  return (
    <div>
      <section className={cn('flex flex-col', isCover && 'min-h-[calc(100svh-5rem)]')}>
      <div className={cn(isCover && 'flex flex-1 flex-col justify-center')}>
      {!search.q && effectiveTrack === 'paper' && (
        <p className="mb-2 text-center text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
          WORKS
        </p>
      )}
      <PageHeader
        title={
          search.q
            ? '搜索结果'
            : effectiveTrack === 'paper'
              ? '作品'
              : '自由创作'
        }
        size={!search.q && effectiveTrack === 'paper' ? 'cover' : 'default'}
        description={
          search.q
            ? `在全站作品中检索“${search.q}”，命中 ${data?.meta.total ?? '…'} 条。`
            : effectiveTrack === 'paper'
              ? '严肃写作与荒诞论文体各自分区：一种认真把事情写清楚，一种用论文格式把荒诞写认真。'
              : '自由创作：小说、随笔、评论、指南与吐槽，不套论文体。'
        }
      />

      {/* 作品目录：一级是“学术 / 荒诞”，二级是学科。先看目录，再看文章，
          不再把两种论文混成一条从上到下的列表。 */}
      {effectiveTrack === 'paper' && !search.q ? (
        <PaperDirectory
          paperKind={paperKind}
          seriousCount={seriousCount}
          absurdCount={absurdCount}
          updateSearch={updateSearch}
        />
      ) : null}

      </div>
      {isCover ? <ScrollCue label="向下浏览目录" className="pb-36 sm:pb-10" /> : null}
      </section>

      {/* 顶部只留视图切换。论文 / 自由创作的主入口在侧栏与移动端「更多」菜单，
          页面内不再放第二套轨道分段，避免同一屏出现两个切换器。 */}
      <div className="mb-0 hidden flex-wrap items-center justify-between gap-2 sm:mb-4 sm:flex">
        <p className="text-[13px] text-muted-foreground">
          {effectiveTrack === 'paper'
            ? paperKind === 'absurd'
              ? '荒诞论文体：论文格式不变，命题一本正经地荒诞'
              : '严肃写作：真实问题 · 可核查材料 · 正经论证'
            : '自由创作：小说、随笔、评论、指南与吐槽。'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-10 px-4" onClick={shuffleFeed} title="随机换一批">
            <RefreshCw className="h-4 w-4" />
            换一批
          </Button>
          <ViewSwitcher
            value={viewMode}
            onChange={(view) => updateSearch({ view })}
          />
        </div>
      </div>

      {/* 桌面端：筛选常驻卡片（md 及以上） */}
      {!isMobile && (
        <DesktopFilters search={search} updateSearch={updateSearch} />
      )}

      {/* 移动端：筛选收进可折叠面板，默认收起，避免挤占浏览空间 */}
      {isMobile && <MobileFilters search={search} updateSearch={updateSearch} track={statsTrack} resultTotal={data?.meta.total} onShuffle={shuffleFeed} />}

      {/* 批量选择/导出是桌面管理操作，移动端隐藏以保持浏览专注 */}
      {!isMobile && selectedIds.length > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-md border bg-muted/40 px-4 py-2">
          <span className="text-sm">已选 {selectedIds.length} 项</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4" />
                导出为…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {EXPORT_FORMATS.map((item) => (
                <DropdownMenuItem key={item.format} onClick={() => onExport(item.format)}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

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
          title={search.q ? '没有找到匹配的内容' : '这一区还空着'}
          description={
            search.q
              ? '换个更短的关键词，或点上方“清除搜索”回到全部作品。'
              : effectiveTrack === 'paper'
                ? '换个筛选条件，或切到另一个写作分区看看。'
                : '还没有匹配的自由创作，换个筛选条件。'
          }
        />
      ) : viewMode === 'index' ? (
        // 默认索引：手机一栏，桌面两栏；没有封面、没有卡片，标题和摘要先读。
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
                  {isAuthenticated && (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        disabled={isFetching}
                        aria-label="全选"
                      />
                    </TableHead>
                  )}
                  <TableHead className="w-[45%] lg:w-auto">标题</TableHead>
                  <TableHead className="w-[30%] lg:w-auto">作者</TableHead>
                  {/* 平板（768–1023）放不下 6 列：年份/学科先让位，
                      否则整表被裁成「标题 + 作者」两列，读者以为坏了。 */}
                  <TableHead className="hidden w-16 lg:table-cell">年份</TableHead>
                  <TableHead className="hidden lg:table-cell">学科</TableHead>
                  <TableHead className="w-20">类型</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((r) => {
                  const authors = formatAuthors(r.authors)
                  return (
                    <TableRow
                      key={r.id}
                      data-state={selectedIds.includes(r.id) ? 'selected' : undefined}
                    >
                      {isAuthenticated && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(r.id)}
                            onChange={() => toggleOne(r.id)}
                            disabled={isFetching}
                            aria-label={`选择 ${r.title}`}
                          />
                        </TableCell>
                      )}
                      {/* 长文本列约束列宽 + 截断，防止 160 字符标题把整表撑出视口
                          （对齐 shadcn DataTable 长文本列 max-w+truncate 惯例） */}
                      <TableCell className="max-w-[320px] truncate">
                        <Link
                          to="/catalog/$resourceId"
                          params={{ resourceId: String(r.id) }}
                          className="font-medium hover:text-primary"
                        >
                          {r.title}
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
                          <Badge variant="secondary">{displayTypeLabel(r.type, r.content_category, r.content_track, r.track)}</Badge>
                          {r.is_special_issue ? (
                            <Badge variant="outline" className="border-rose-300 text-rose-700 text-[10px]">
                              特别篇
                            </Badge>
                          ) : null}
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

      <Dialog
        open={preflight !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreflight(null)
            setPendingFormat(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
              导出前检查
            </DialogTitle>
            <DialogDescription>
              这些字段缺失不会阻止导出，但会让引用文件不完整。建议先补齐再导出。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto text-sm">
            {preflight?.missing_ids.length ? (
              <p className="rounded-md border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                {preflight.missing_ids.length} 条资源已删除或未公开，将被跳过。
              </p>
            ) : null}
            {preflight?.warnings.map((warning, index) => (
              <div key={`${warning.resource_id}-${warning.code}-${index}`} className="rounded-md border px-3 py-2">
                <p className="font-medium">{warning.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{warning.message}</p>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPreflight(null)
                setPendingFormat(null)
              }}
            >
              先去补齐
            </Button>
            <Button
              onClick={() => {
                const format = pendingFormat
                setPreflight(null)
                setPendingFormat(null)
                if (format) void runExport(format)
              }}
            >
              仍然导出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// 总目录落地页：不把论文/自由创作做成两张“门户卡”。
// 用一个编辑目录：先论文（学术 / 荒诞两行），再自由创作（文体一行），
// 学科与文体都退成索引文字，读者先看清层级，再进入。
function CatalogHub() {
  const { data: stats } = useCatalogStats()
  const seriousTotal = stats?.by_paper_kind?.serious
  const absurdTotal = stats?.by_paper_kind?.absurd
  const paperTotal = seriousTotal == null || absurdTotal == null ? undefined : seriousTotal + absurdTotal
  const genreCounts = stats?.by_genre ?? {}
  const essayTotal = stats
    ? stats.by_track?.essay ?? Object.values(genreCounts).reduce((a, b) => a + b, 0)
    : undefined
  const disciplines = Object.entries(stats?.by_discipline ?? {})
    .filter(([name]) => name && name !== '未分类')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const genres = ESSAY_GENRES.filter((g) => (genreCounts[g.value] ?? 0) > 0)

  const rowClass =
    'group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 py-5 transition-colors hover:text-primary'

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <PageHeader
        title="作品库"
        description="论坛里的长文存档：严肃写作、荒诞论文体、自由创作。想发短帖去论坛，想写长文放这里。"
      />

      <section className="mt-10 border-t pt-7">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">I · Writing</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight">写作</h2>
          </div>
          <p className="font-mono text-sm tabular-nums text-muted-foreground">
            {paperTotal ?? '…'} 篇
          </p>
        </div>

        <div className="mt-6 divide-y border-y">
          <Link to="/catalog" search={{ kind: 'serious' }} className={rowClass}>
            <span className="font-mono text-xs text-muted-foreground">01</span>
            <span className="min-w-0">
              <span className="block font-serif text-xl font-semibold">严肃写作</span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                真实问题、可核查材料、正经论证；先把事情写清楚。
              </span>
            </span>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {seriousTotal ?? '…'} 篇 →
            </span>
          </Link>

          <Link to="/catalog" search={{ kind: 'absurd' }} className={rowClass}>
            <span className="font-mono text-xs text-absurd">02</span>
            <span className="min-w-0">
              <span className="block font-serif text-xl font-semibold">荒诞论文体</span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                用论文格式一本正经地论证荒诞命题；越认真越好笑。
              </span>
            </span>
            <span className="font-mono text-sm tabular-nums text-muted-foreground">
              {absurdTotal ?? '…'} 篇 →
            </span>
          </Link>
        </div>

        {disciplines.length > 0 && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-xs font-medium text-muted-foreground">按学科进入</p>
              <Link to="/catalog" search={{ track: 'paper' }} className="text-[11px] text-primary hover:underline">
                全部学科
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {disciplines.map(([name, count]) => (
                <Link
                  key={name}
                  to="/catalog" search={{ track: 'paper', discipline: name }}
                  className="inline-flex items-baseline gap-1.5 text-sm transition-colors hover:text-primary"
                >
                  <span>{name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{count}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mt-12 border-t pt-7">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">II · Free writing</p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight">自由创作</h2>
          </div>
          <Link to="/catalog" search={{ track: 'essay' }} className="text-sm text-primary hover:underline">
            进入自由创作 →
          </Link>
        </div>

        <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
          {essayTotal ?? '…'} 篇 · 小说、随笔、评论、指南、吐槽；不用论文体，只谈写得好不好。
        </p>

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
          自由创作不计分，也不进站内热度；推荐与最新作品按文体展开。
        </p>
      </section>
    </div>
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
      placeholder="标题/作者/摘要"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value)
      }}
    />
  )
}

// 桌面常驻卡片与移动折叠面板共用同一组筛选字段（此前是整段复制）。
// 两边只有容器布局不同，所以布局由调用方用 className 指定。
function CatalogFilterFields({
  search,
  updateSearch,
  className,
  hideSearch = false,
}: {
  search: CatalogSearch
  updateSearch: (patch: Partial<CatalogSearch>) => void
  className: string
  hideSearch?: boolean
}) {
  const { data: stats } = useCatalogStats()
  const facetDisciplines = Object.keys(stats?.by_discipline ?? {})
  return (
    <div className={className}>
      {hideSearch ? null : (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            搜索（输入即搜，回车立即）
          </label>
          <DebouncedSearchInput
            initial={search.q ?? ''}
            onCommit={(q) => updateSearch({ q: q || undefined, page: 1 })}
          />
        </div>
      )}
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
        <label className="text-xs text-muted-foreground">栏目</label>
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
            <SelectItem value="all">全部栏目</SelectItem>
            {ARTICLE_SECTION_OPTIONS.map((section) => (
              <SelectItem key={section.value} value={section.value}>
                {section.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">学科</label>
        <Select
          value={search.discipline ?? 'all'}
          onValueChange={(v) =>
            updateSearch({ discipline: v === 'all' ? undefined : v, page: 1 })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部学科</SelectItem>
            {(facetDisciplines.length > 0
              ? facetDisciplines
              : search.discipline
                ? [search.discipline]
                : []
            ).map((d) => (
              <SelectItem key={d} value={d}>
                {d}
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

// 移动端筛选：默认收起，点击"筛选"展开。字段与桌面共用，只是容器形态不同。
function MobileFilters({
  search,
  updateSearch,
  track,
  resultTotal,
  onShuffle,
}: {
  search: CatalogSearch
  updateSearch: (patch: Partial<CatalogSearch>) => void
  track?: 'paper' | 'essay'
  resultTotal?: number
  onShuffle?: () => void
}) {
  const [open, setOpen] = useState(false)
  const activeCount = [
    search.q,
    search.type,
    search.discipline,
    search.year,
    search.year_from,
    search.year_to,
    search.author,
    search.section,
    search.volume,
    search.issue,
  ].filter(Boolean).length

  return (
    <div className="mb-3">
      {track && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-[13px] font-medium text-foreground">
            {track === 'paper' ? '作品目录' : '自由创作'}
            <span className="ml-1.5 font-normal text-muted-foreground">
              · {resultTotal ?? '…'} 篇
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">按最近更新随机编排</p>
        </div>
      )}
      <div className="flex items-start gap-2">
        {/* 搜索是目录页的第一动作；筛选收成同一行的一个按钮，不再占一整行。 */}
        <div className="min-w-0 flex-1">
          <DebouncedSearchInput
            initial={search.q ?? ''}
            onCommit={(q) => updateSearch({ q: q || undefined, page: 1 })}
          />
        </div>
        {onShuffle && (
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0 gap-1 px-2.5 text-xs"
            onClick={onShuffle}
            aria-label="随机换一批"
            title="随机换一批"
          >
            <RefreshCw className="h-4 w-4" />
            换一批
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="relative h-10 w-12 shrink-0 px-0"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? '收起筛选' : '展开筛选'}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
              {activeCount}
            </span>
          )}
        </Button>
      </div>

      {open && (
        <div className="mt-3 rounded-lg border bg-muted/30 p-3">
          <DisciplineChips search={search} updateSearch={updateSearch} track={track} resultTotal={resultTotal} />
          <CatalogFilterFields
            search={search}
            updateSearch={updateSearch}
            className="mt-3 space-y-3"
            hideSearch
          />
        </div>
      )}
    </div>
  )
}

// 桌面端筛选：与移动端同策略——默认收起为一行工具栏（带活跃计数），
// 带着筛选条件进来时自动展开，避免"打开页面先看到一面筛选墙"。
function DesktopFilters({
  search,
  updateSearch,
}: {
  search: CatalogSearch
  updateSearch: (patch: Partial<CatalogSearch>) => void
}) {
  const activeCount = [
    search.q,
    search.type,
    search.discipline,
    search.year,
    search.year_from,
    search.year_to,
    search.author,
    search.section,
    search.volume,
    search.issue,
  ].filter(Boolean).length
  const [open, setOpen] = useState(() => activeCount > 0)

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-between"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            筛选
            {activeCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {activeCount}
              </span>
            )}
          </span>
        </Button>
        {activeCount > 0 && !open && (
          <span className="text-xs text-muted-foreground">正在按条件过滤，点击「筛选」可调整</span>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-lg border bg-muted/30 p-3">
          <CatalogFilterFields
            search={search}
            updateSearch={updateSearch}
            className="grid grid-cols-1 gap-3 md:grid-cols-4"
          />
        </div>
      )}
    </div>
  )
}

// 栏目（学科）快捷筛选：期刊网站的 browse-by-subject 惯例，
// 带篇数计数，点击即筛。超过 8 个时默认收起一排展开按钮 ——
// 已选中的栏目即使排在收起区也会补显出来，不让筛选条件"隐身"。
const CHIP_COLLAPSE_AT = 8

function PaperDirectory({
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
      label: '严肃写作',
      note: '真实问题 · 可核查材料 · 正经论证',
      count: seriousCount,
      activeClass: 'border-primary text-primary',
    },
    {
      id: 'absurd' as const,
      label: '荒诞论文体',
      note: '论文格式不变 · 命题一本正经地荒诞',
      count: absurdCount,
      activeClass: 'border-absurd text-absurd',
    },
  ]
  const activeKind = kinds.find((kind) => kind.id === paperKind) ?? kinds[0]

  return (
    <section className="mb-8 border-y" aria-label="作品目录">
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
  // 搜索态下学科 chip 的计数是“全站存量”，与命中数无关，
  // 继续展示会让人以为“心理学 38 条”就是搜索结果。这里换成结果摘要。
  if (search.q) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="搜索结果摘要">
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
    <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label="按学科（栏目）快速筛选">
      <button
        type="button"
        className={chipCls(!search.discipline)}
        onClick={() => updateSearch({ discipline: undefined, page: 1 })}
      >
        {track === 'paper' ? '写作' : track === 'essay' ? '自由创作' : '全部'}
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
          更多 {hiddenCount} 个学科
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
