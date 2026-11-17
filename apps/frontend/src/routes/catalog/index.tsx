import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { AlertTriangle, BookOpen, ChevronDown, Download, FileDown, FlaskConical, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react'
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
import { DISCIPLINE_STYLE, DEFAULT_DISCIPLINE_STYLE } from '@/lib/discipline-style'
import { ESSAY_GENRES } from '@/lib/essay-genres'
import { PageHeader } from '@/components/common/page-header'
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
import { ResourceCard } from '@/components/mobile/ResourceCard'
import { CatalogGridCard } from './-catalog-grid-card'
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
  page?: number
  view?: 'list' | 'grid'
}

// 论文与副刊是两本刊，入口固定在侧栏与移动端底部 Tab；
// 页面内不再维护第二套轨道分段控件。
const TYPE_OPTIONS: { value: ResourceType | 'all'; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'paper', label: '论文' },
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

export function CatalogListPage({ fixedTrack }: { fixedTrack?: 'paper' | 'essay' } = {}) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as CatalogSearch
  const { isAdmin, isAuthenticated } = useAuth()
  const isMobile = useIsMobile()

  // 轨道切换 → 后端 ?track=paper|essay（按 content_track 过滤，与旧 content_category 解耦）。
  // fixedTrack 由 /papers、/fun 两条独立路由传入，避免用户从娱乐区又切回混合列表。
  const effectiveTrack: 'paper' | 'essay' | undefined =
    fixedTrack ?? search.track
  // /papers 默认进入「学术论文」；荒诞论文是同页的并列分区，不是另一条轨道。
  const paperKind: 'serious' | 'absurd' = search.kind ?? 'serious'
  const statsTrack = effectiveTrack === 'essay' ? 'essay' : effectiveTrack === 'paper' ? 'paper' : undefined
  const routePath: '/papers' | '/fun' | '/catalog' = fixedTrack === 'paper'
    ? '/papers'
    : fixedTrack === 'essay'
      ? '/fun'
      : '/catalog'

  // 目录首页采用「可复现随机」：每次进入/点“换一批”换 seed，分页仍稳定；
  // 搜索时回到相关度/新近排序，避免随机打乱检索结果。
  const [feedSeed, setFeedSeed] = useState(() => Math.floor(Math.random() * 2147483646) + 1)
  const randomFeed = Boolean(fixedTrack) && !search.q && !search.author && !search.doi && !search.clc

  const params = {
    q: search.q || undefined,
    type: search.type,
    category: search.category || undefined,
    // 搜索结果页的文案是“全站论文与副刊”，所以有关键词时必须解除当前分区
    // 的 track/paper_kind 收窄；否则 109 这类已改判荒诞、或被分到副刊的稿
    // 在 /papers?q= 下会假性 0 命中（API 直查是有结果的）。
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
    page: search.page || 1,
    page_size: 10,
    sort: randomFeed ? ('random' as const) : undefined,
    seed: randomFeed ? feedSeed : undefined,
  }

  const { data, isLoading, isFetching, isError, refetch } = useResources(params)
  const { data: stats } = useCatalogStats(statsTrack)

  const seriousCount = stats?.by_paper_kind?.serious ?? 0
  const absurdCount = stats?.by_paper_kind?.absurd ?? 0

  const [selectedIds, setSelectedIds] = useState<number[]>([])
  // 默认视图 = 九宫格（v1.15）：封面浏览是目录页第一动作；?view=list 时才切列表。
  const viewMode: 'list' | 'grid' = search.view === 'list' ? 'list' : 'grid'

  // 筛选条件写到 URL，replace 避免每次筛选都污染历史。
  // 顺带清空勾选：翻页/改筛选后旧 id 已经不在页面上，留着会让「导出」
  // 把用户看不见的记录也一起导出去。
  const updateSearch = (patch: Partial<CatalogSearch>) => {
    setSelectedIds([])
    void navigate({
      to: routePath,
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
        routePath={routePath}
        onShuffle={shuffleFeed}
      />
    )
  }

  // 总目录不再把所有内容混成一列：先让读者选「论文 / 副刊」，
  // 论文里再选「学术 / 荒诞」。带检索词时仍走下面的跨区结果列表。
  const hasCatalogFilter = Boolean(
    search.q || search.type || search.category || search.discipline || search.year,
  )
  if (!fixedTrack && !hasCatalogFilter) {
    return <CatalogHub />
  }

  return (
    <div>
      <section className="flex min-h-[calc(100svh-5rem)] flex-col justify-center">
      <PageHeader
        title={
          search.q
            ? '搜索结果'
            : fixedTrack === 'paper'
              ? paperKind === 'absurd'
                ? '荒诞论文'
                : '学术论文'
              : fixedTrack === 'essay'
                ? '副刊'
                : '论文与副刊'
        }
        description={
          search.q
            ? `在全站论文与副刊中检索“${search.q}”，命中 ${data?.meta.total ?? '…'} 条。`
            : fixedTrack === 'essay'
              ? '小说、随笔、评论、诗歌与吐槽；独立成刊，不用论文体、不参与学术计分。'
              : fixedTrack === 'paper'
                ? paperKind === 'absurd'
                  ? '严格论文格式，用可核查材料一本正经地论证荒诞命题；与学术论文同用百分制评审。'
                  : '真实问题、可核查材料、正经论证；副刊与荒诞论文都在各自独立分区。'
                : '论文与副刊分属两本刊；论文内部再分学术论文与荒诞论文。'
        }
        actions={
          isAdmin ? (
            <Button asChild>
              <Link to="/catalog/new">
                <Plus className="h-4 w-4" />
                新建资源
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* 论文目录：一级是“学术 / 荒诞”，二级是学科。先看目录，再看文章，
          不再把两种论文混成一条从上到下的列表。 */}
      {effectiveTrack === 'paper' && !search.q ? (
        <PaperDirectory
          paperKind={paperKind}
          seriousCount={seriousCount}
          absurdCount={absurdCount}
          updateSearch={updateSearch}
        />
      ) : null}

      <p className="mt-10 text-center text-[11px] uppercase tracking-[0.3em] text-muted-foreground/70">
        向下浏览目录 · Scroll
      </p>
      </section>

      {/* 顶部只留视图切换。论文 / 副刊的主入口在侧栏与移动端「更多」菜单，
          页面内不再放第二套轨道分段，避免同一屏出现两个切换器。 */}
      <div className="mb-0 hidden flex-wrap items-center justify-between gap-2 sm:mb-4 sm:flex">
        <p className="text-xs text-muted-foreground">
          {fixedTrack === 'paper'
            ? paperKind === 'absurd'
              ? '荒诞论文：论文格式与评审标准不变，命题一本正经地荒诞'
              : '学术论文：编辑评审 · 百分制计分 · 站内热度仅内部参考'
            : fixedTrack === 'essay'
              ? '副刊轨：非论文格式 · 格式与合规检查 · 不计分 · 独立成刊'
              : '论文与副刊分属两条轨道，从左侧导航或底部 Tab 进入对应目录。'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={shuffleFeed} title="随机换一批">
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
              ? '换个更短的关键词，或点上方“清除搜索”回到全刊目录。'
              : fixedTrack === 'paper'
                ? '换个筛选条件，或切到另一个论文分区看看。'
                : '还没有匹配的副刊，换个筛选条件。'
          }
        />
      ) : viewMode === 'grid' ? (
        // 手机端单列：390px 下两列会把中文标题压成半行，读者必须先猜标题；
        // 平板 2 列、桌面 4 列。九宫格留给桌面，手机优先可读性。
        <div className="catalog-grid-wrap">
          <div className="catalog-grid" data-testid="catalog-resource-list">
          {data.data.map((r) => (
            <CatalogGridCard key={r.id} resource={r} query={search.q} />
          ))}
          </div>
        </div>
      ) : isMobile ? (
        // 移动端：卡片列表（独立设计，无批量勾选）
        <div className="space-y-3" data-testid="catalog-resource-list">
          {data.data.map((r) => (
            <ResourceCard key={r.id} resource={r} />
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

// 总目录落地页：三区入口。读者先选「论文 / 副刊」，论文内部再选
// 「学术论文 / 荒诞论文」；不把 274 篇混在一列里。
function CatalogHub() {
  const { data: stats } = useCatalogStats()
  const seriousTotal = stats?.by_paper_kind?.serious ?? 0
  const absurdTotal = stats?.by_paper_kind?.absurd ?? 0
  const genreCounts = stats?.by_genre ?? {}
  const essayTotal = stats?.by_track?.essay ?? Object.values(genreCounts).reduce((a, b) => a + b, 0)
  const disciplines = Object.entries(stats?.by_discipline ?? {})
    .filter(([name]) => name && name !== '未分类')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const genres = ESSAY_GENRES.filter((g) => (genreCounts[g.value] ?? 0) > 0)

  const zoneLink = 'group flex items-start gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-muted/20'
  const miniLink = 'group flex min-h-16 items-center gap-2.5 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-left transition-colors hover:border-primary/35 hover:bg-accent/20'

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="目录"
        description="论文与副刊是两本刊。论文内部再分学术论文与荒诞论文：前者正经研究，后者严格论文格式但一本正经地论证荒诞命题。"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border bg-gradient-to-br from-card to-muted/20 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Paper</p>
              <h2 className="mt-1 font-serif text-xl font-semibold">论文</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {seriousTotal} 篇学术论文 · {absurdTotal} 篇荒诞论文
              </p>
            </div>
            <Link to="/papers" className="shrink-0 rounded-full border px-3 py-1 text-xs hover:bg-background">
              进入论文区
            </Link>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Link to="/papers" search={{ kind: 'serious' }} className={zoneLink}>
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              <span className="min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">学术论文</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{seriousTotal} 篇</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">真实问题、可核查材料、正经论证</span>
              </span>
            </Link>
            <Link to="/papers" search={{ kind: 'absurd' }} className={zoneLink}>
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
              <span className="min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">荒诞论文</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{absurdTotal} 篇</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">论文格式、一本正经胡说八道、有论证有依据</span>
              </span>
            </Link>
          </div>

          <div className="mt-4 border-t pt-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">按学科进入</p>
              <Link to="/papers" className="text-[11px] text-primary hover:underline">全部学科</Link>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {disciplines.map(([name, count]) => {
                const style = DISCIPLINE_STYLE[name] ?? DEFAULT_DISCIPLINE_STYLE
                const Icon = style.icon
                return (
                  <Link
                    key={name}
                    to="/papers"
                    search={{ discipline: name }}
                    className={miniLink}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${style.tint}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{name}</span>
                      <span className="block text-[10px] text-muted-foreground">{count} 篇 · 全刊</span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-gradient-to-br from-card to-muted/20 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Supplement</p>
              <h2 className="mt-1 font-serif text-xl font-semibold">副刊</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {essayTotal} 篇 · 小说、随笔、评论、指南、吐槽；不用论文体、不计分
              </p>
            </div>
            <Link to="/fun" className="shrink-0 rounded-full border px-3 py-1 text-xs hover:bg-background">
              进入副刊
            </Link>
          </div>

          <div className="mt-4 border-t pt-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">按文体进入</p>
              <Link to="/fun" className="text-[11px] text-primary hover:underline">全部文体</Link>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {genres.map((g) => (
                <Link
                  key={g.value}
                  to="/fun"
                  search={{ genre: g.value }}
                  className={miniLink}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-base">
                    {g.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{g.label}</span>
                    <span className="block text-[10px] text-muted-foreground">{genreCounts[g.value]} 篇</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-dashed bg-muted/25 px-3 py-2 text-[11px] text-muted-foreground">
            副刊不参与学术计分，也不进站内热度；编辑推荐与最新稿件在副刊页内按文体展开。
          </div>
        </section>
      </div>
    </div>
  )
}

function ViewSwitcher({
  value,
  onChange,
}: {
  value: 'list' | 'grid'
  onChange: (view: 'list' | 'grid') => void
}) {
  return (
    <div
      className="inline-flex rounded-md border p-0.5 text-xs"
      role="group"
      aria-label="切换视图"
    >
      {(['grid', 'list'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'rounded px-3 py-1 transition-colors',
            value === v
              ? 'bg-primary font-medium text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {v === 'list' ? '列表' : '网格'}
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
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">DOI</label>
        <Input
          placeholder="10.xxxx/..."
          defaultValue={search.doi ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value.trim()
              updateSearch({ doi: v || undefined, page: 1 })
            }
          }}
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">中图分类号</label>
        <Input
          placeholder="如 TP / I24"
          defaultValue={search.clc ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = (e.target as HTMLInputElement).value.trim().toUpperCase()
              updateSearch({ clc: v || undefined, page: 1 })
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
    search.doi,
    search.clc,
  ].filter(Boolean).length

  return (
    <div className="mb-3">
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
    search.doi,
    search.clc,
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
  seriousCount: number
  absurdCount: number
  updateSearch: (patch: Partial<CatalogSearch>) => void
}) {
  const kinds = [
    {
      id: 'serious' as const,
      label: '学术论文',
      note: '真实问题 · 可核查材料 · 正经论证',
      count: seriousCount,
      icon: BookOpen,
      tone: 'from-emerald-500/15 via-card to-card',
      dot: 'bg-emerald-500',
    },
    {
      id: 'absurd' as const,
      label: '荒诞论文',
      note: '论文格式不变 · 命题一本正经地荒诞',
      count: absurdCount,
      icon: FlaskConical,
      tone: 'from-amber-500/15 via-card to-card',
      dot: 'bg-amber-500',
    },
  ]

  return (
    <section className="mb-3 space-y-2 sm:mb-5 sm:space-y-3" aria-label="论文目录">
      <div className="grid grid-cols-2 gap-2 sm:gap-3" role="tablist" aria-label="论文分区">
        {kinds.map((kind) => {
          const active = paperKind === kind.id
          const Icon = kind.icon
          return (
            <button
              key={kind.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => updateSearch({ kind: kind.id, discipline: undefined, page: 1 })}
              className={cn(
                'group relative overflow-hidden rounded-2xl border p-2.5 text-left transition-all sm:p-5',
                active
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-gradient-to-br hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-sm',
                !active && kind.tone,
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10', active ? 'bg-white/15' : 'bg-background/80')}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 flex-col sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
                      <span className="whitespace-nowrap font-serif text-base font-semibold tracking-tight sm:text-lg">{kind.label}</span>
                      <span className={cn('mt-0.5 text-xs tabular-nums sm:mt-0', active ? 'text-white/80' : 'text-muted-foreground')}>
                        {kind.count} 篇
                      </span>
                    </span>
                    <span className={cn('mt-0.5 hidden text-xs leading-5 sm:block', active ? 'text-white/80' : 'text-muted-foreground')}>
                      {kind.note}
                    </span>
                  </span>
                </div>
                <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', active ? 'bg-white/80' : kind.dot)} />
              </div>
            </button>
          )
        })}
      </div>

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
        {track === 'paper' ? '论文轨' : track === 'essay' ? '副刊' : '全部'}
        <span className="tabular-nums opacity-60">{stats?.total ?? 0}</span>
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
