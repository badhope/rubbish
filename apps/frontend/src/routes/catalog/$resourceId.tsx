import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  Bookmark,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  ListTree,
  MessagesSquare,
  MoreVertical,
  Pencil,
  Quote,
  Send,
  Share2,
  Trash2,
  UserCheck,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { useIsMobile } from '@/hooks/use-is-mobile'
import {
  useClaimStatus,
  useDeleteResource,
  useRecordView,
  useResource,
  useResources,
  useUpdateResource,
} from '@/hooks/api/use-modules'
import { api } from '@/lib/api'
import type {
  AuthorDetail,
  ResourceHistory,
  ResourceResponse,
  ResourceUpdate,
} from '@/lib/types'
import { normalizeAbstract } from '@/lib/abstract'
import { extractError, parseListField, sanitizeAuthors } from '@/lib/utils'
import { formatCitation, type CitationStyle } from '@/lib/citation'
import { safeHref } from '@/lib/url-safety'
import {
  contentCategoryLabel,
  contentTrackKind,
  displayTypeLabel,
  isScholarlyContent,
  languageLabel,
  qualityGrade,
  statusLabel,
  type ContentKind,
} from '@/lib/resource-labels'
import { ManuscriptView, type TocEntry } from '@/components/common/manuscript-view'
import PdfImagePreview from '@/components/pdf-image-preview'
import { ArticleEngagement } from '@/components/catalog/article-engagement'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AddToListDialog } from '@/components/common/add-to-list-dialog'
import { BottomSheet } from '@/components/common/bottom-sheet'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Comments } from '@/components/common/comments'
import { FunArticle } from '@/components/catalog/fun-article'
import { MetaItem } from '@/components/common/meta-item'
import { ErrorState, LoadingSkeleton } from '@/components/common/state'

const CITATION_STYLES: { value: CitationStyle; label: string }[] = [
  { value: 'gb-t-7714', label: 'GB/T 7714' },
  { value: 'apa', label: 'APA 7' },
  { value: 'mla', label: 'MLA 9' },
]

// 详情页向访客开放（后端 GET /catalog/{id} 本就是公开接口）。
// v5：点开即正文——标题/作者/标签后直接渲染 Markdown 正文，不再跳 /reader。
export const Route = createFileRoute('/catalog/$resourceId')({
  component: CatalogDetailPage,
})

function CatalogDetailPage() {
  const { resourceId } = Route.useParams()
  const id = Number(resourceId)
  const forumQ = useQuery({
    queryKey: ['forum', 'paper-count', id],
    queryFn: async () => (await api.get('/forum/topics', { params: { paper_id: id, page_size: 1 } })).data,
    enabled: Number.isFinite(id) && id > 0,
  })
  const discussCount: number = forumQ.data?.meta?.total ?? 0
  const historyQ = useQuery<ResourceHistory>({
    queryKey: ['catalog', 'history', id],
    queryFn: async () => (await api.get(`/catalog/${id}/history`)).data,
    enabled: Number.isFinite(id) && id > 0,
  })
  const navigate = useNavigate()
  const { isAdmin, isAuthenticated, user } = useAuth()

  const { data, isLoading, isError, refetch } = useResource(id)
  const recordView = useRecordView()
  const updateMut = useUpdateResource()
  const deleteMut = useDeleteResource()
  const isMobile = useIsMobile()

  const viewRecordedRef = useRef<number | null>(null)
  const recordViewRef = useRef(recordView)
  useEffect(() => {
    if (!isAuthenticated || viewRecordedRef.current === id) return
    viewRecordedRef.current = id
    void recordViewRef.current.mutateAsync(id).catch(() => {})
  }, [id, isAuthenticated])

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [eventOpen, setEventOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false)
  const claimStatus = useClaimStatus(id, true)

  // ManuscriptView 把 TOC 上提到这里，供右侧 sticky 侧栏渲染。
  const [toc, setToc] = useState<TocEntry[]>([])
  const [progress, setProgress] = useState(0)
  const [showTop, setShowTop] = useState(false)
  // 稿件加载失败（409 needs_docx / 404 无正文）时由 ManuscriptView 回调上来。
  const [manuscriptError, setManuscriptError] = useState<unknown>(null)

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0)
      setShowTop(window.scrollY > 640)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (isLoading) return <LoadingSkeleton rows={6} />
  if (isError || !data) {
    return (
      <ErrorState
        message="加载资源失败"
        onRetry={() => refetch()}
      />
    )
  }

  const onDelete = async () => {
    try {
      await deleteMut.mutateAsync(id)
      toast.success('已删除')
      void navigate({
        to: '/catalog',
        search: data?.content_track === 'essay' ? { track: 'essay' } : { track: 'paper' },
      })
    } catch {
      toast.error('删除失败')
    }
  }

  const isScholarly = isScholarlyContent(data.content_category, data.content_track)
  const kind: ContentKind = contentTrackKind(data.content_category, data.content_track)
  // 以 content_track 为唯一判据：essay=娱乐轨，隐藏全部学术区块；paper=论文轨，
  // 学术区块必须保留。不猜摘要/CLC 是否存在。
  const isEssayTrack = data.content_track === 'essay'
  const isPaperTrack = data.content_track === 'paper'
  const cleanAuthors = sanitizeAuthors(data.authors)
  // 与 PDF 同一套规则：长标题里的“——副标题”单独成行，避免连接号被挤到行尾。
  const titleParts = (data.title || '').split(/\s*——\s*/)
  const titleMain = titleParts[0]
  const titleSub = titleParts.slice(1).join('——')
  const currentUsername = user?.username?.trim().toLowerCase() ?? ''
  const isAuthor =
    !!currentUsername &&
    cleanAuthors.some((a) => a.trim().toLowerCase() === currentUsername)
  const ownerBound = claimStatus.data?.state === 'claimed'
  const canClaim =
    isAuthenticated && !isAuthor && !ownerBound && claimStatus.data?.claimable === true

  // 娱乐轨直接走独立文章版式：不渲染摘要卡、CLC、引用、评审、PDF、R 评分，
  // 也不使用论文页的侧栏与 3/4 封面。论文轨继续走下面的学术版式。
  if (isEssayTrack) {
    return (
      <>
        <FunArticle
          data={data}
          progress={progress}
          isAuthenticated={isAuthenticated}
          isAdmin={isAdmin}
          onEdit={() => setEditOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          onSave={() => setListOpen(true)}
        />
        {editOpen && (
          <EditDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            initial={data}
            onSubmit={async (body) => {
              try {
                await updateMut.mutateAsync({ id, body })
                toast.success('已更新')
                setEditOpen(false)
              } catch (err) {
                toast.error(extractError(err, '更新失败'))
              }
            }}
          />
        )}
        {isAuthenticated && (
          <AddToListDialog resourceId={id} open={listOpen} onOpenChange={setListOpen} />
        )}
        <ConfirmDialog
          open={deleteOpen}
          title="删除资源"
          description="确认删除该资源？此操作不可撤销。"
          confirmText="删除"
          destructive
          onOpenChange={setDeleteOpen}
          onConfirm={onDelete}
        />
      </>
    )
  }

  // 评分细则与分区口径只对审稿/编辑端可见：后端详情接口已对非 staff
  // 清空 quality_* / quartile，前端再按角色 gate 渲染，避免「尚未评分」占位。
  const SCORE_STAFF_ROLES = new Set([
    'reviewer', 'senior_reviewer', 'editor', 'section_editor',
    'board_editor', 'deputy_editor', 'chief_editor', 'editor_in_chief',
  ])
  const canSeeScores =
    isAdmin || (user?.roles ?? []).some((r) => SCORE_STAFF_ROLES.has(r))

  return (
    <div className={isMobile ? 'pb-20' : ''}>
      {/* 顶栏阅读进度：读者随时知道还剩多少，不占正文空间 */}
      <div className="fixed left-0 top-0 z-50 h-[2px] w-full bg-transparent">
        <div
          className="h-full bg-primary transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>
      <Link
        to="/catalog"
        search={{ track: 'paper' }}
        className="mb-3 inline-flex min-h-[36px] items-center text-sm text-muted-foreground hover:text-primary"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        返回目录
      </Link>

      <div className="mx-auto flex w-full max-w-[1280px] items-start gap-10">
        {/* 主体 */}
        <div className="min-w-0 flex-1" id="article">
          {/* 类型 chip + 标题 + 作者 */}
          <div className="mb-5">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {displayTypeLabel(data.type, data.content_category, data.content_track, data.track)}
              </Badge>
              {isEssayTrack && (
                <Badge className="border-amber-400/60 bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  自由创作
                </Badge>
              )}
              {!isEssayTrack && data.content_category ? (
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/25">
                  {contentCategoryLabel(data.content_category)}
                </Badge>
              ) : null}
              {!isEssayTrack &&
              isScholarly &&
              data.r_index != null &&
              (data.reads ?? 0) + (data.downloads ?? 0) + (data.saves ?? 0) >= 3 ? (
                <Badge
                  variant="outline"
                  className="tabular-nums"
                  title="站内热度（R 值）：阅读、下载、收藏的站内加权，只反映站内关注度，不计入学术评分。"
                >
                  热度 {data.r_index.toFixed(1)}
                  {canSeeScores && data.quartile ? ` · ${data.quartile}` : ''}
                </Badge>
              ) : null}
              {data.publication_status !== 'published' && (
                <Badge variant="outline">{statusLabel(data.publication_status)}</Badge>
              )}
              {historyQ.data?.retracted && (
                <Badge variant="destructive" title="本文已撤稿，原文保留用于记录，撤稿说明见下方公开日志。">
                  已撤稿
                </Badge>
              )}
            </div>
            <h1 className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
              {titleMain}
              {titleSub ? (
                <span className="mt-1 block text-base font-normal text-muted-foreground sm:text-lg">
                  {titleSub}
                </span>
              ) : null}
            </h1>
            {historyQ.data?.retracted && (
              <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
                本文已被撤稿。原文保留用于学术记录，撤稿原因与时间见“版本与公开记录”。
              </div>
            )}
            {/* 作者行：优先用 authors_detail（v5）；未认领者邮箱/单位为 null，绝不展示 PDF 抓出来的私人邮箱。 */}
            <AuthorRow detail={data.authors_detail ?? null} fallbackNames={cleanAuthors} />
            {/* 移动端：桌面右栏在 xl 以下整块隐藏，这里补回“规范 PDF / 作者原件”入口，
               否则手机上根本进不去两个预览（只剩底栏直接下载 Word）。 */}
            <div className="mt-3 flex flex-wrap gap-2">
              {data.has_file && isPaperTrack && (
                <div className="flex flex-wrap gap-2 xl:hidden">
                  <Button variant="outline" size="sm" className="min-w-0" onClick={() => setPdfPreviewOpen(true)}>
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="truncate">PDF 版式预览</span>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="min-w-0">
                    <a href={`/api/catalog/${id}/export?format=pdf&v=27`} download>
                      <FileDown className="h-4 w-4 shrink-0" />
                      <span className="truncate">下载 PDF</span>
                    </a>
                  </Button>
                </div>
              )}
              <Button asChild variant="outline" size="sm" className="min-w-0">
                <Link
                  to="/forum"
                  search={{ category: 'paper', paperId: id, paperTitle: data.title }}
                >
                  <MessagesSquare className="h-4 w-4 shrink-0" />
                  <span className="truncate">讨论{discussCount ? ` · ${discussCount}` : ''}</span>
                </Link>
              </Button>
            </div>
          </div>

          {/* 四轨导语/摘要卡：论文=摘要，科普=导语，娱乐/吐槽=不渲染 */}
          {!isEssayTrack && (kind === 'paper' || kind === 'sci_pop') && data.abstract ? (
            <AbstractCard
              text={data.abstract}
              collapsible={isMobile}
              label={kind === 'sci_pop' ? '导语' : '摘要'}
            />
          ) : null}

          {/* 认领卡：仅 claimable && 已登录 && 非作者本人；点击进入 /claim/{id} 表单页 */}
          {canClaim && (
            <Card className="mb-4 border-dashed">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">这篇文章还没有挂到任何站内账号名下</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    如果你是本文作者，可以发起认领，编辑部核实后会把文章挂到你的名下。
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/claim/$resourceId" params={{ resourceId: String(id) }}>
                    <UserCheck className="h-4 w-4" />
                    去认领
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
          {isAuthenticated && claimStatus.data?.mine && (
            <Card className="mb-4 border-primary/30 bg-primary/5">
              <CardContent className="py-3">
                <p className="text-sm">
                  你已提交认领申请（{claimStatus.data.mine.status === 'pending' ? '待编辑部审核' : claimStatus.data.mine.status === 'approved' ? '已批准' : '未通过'}）。
                </p>
              </CardContent>
            </Card>
          )}

          {/* 正文：ManuscriptView 内联渲染，window 原生滚动 */}
          {manuscriptError ? (
            <ScannedPdfFallback resourceId={id} hasFile={Boolean(data.has_file)} />
          ) : (
            <ManuscriptView
              resourceId={id}
              initialPercent={0}
              onProgress={setProgress}
              useWindowScroll
              hideTocNav
              onTocReady={setToc}
              onFatalError={setManuscriptError}
              contentCategory={data.content_category}
              contentTrack={data.content_track}
              title={data.title}
              abstract={data.abstract}
            />
          )}

          {/* 文末折叠区 */}
          <div className="article-tail mt-8 space-y-4">
            {data.tags.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">标签</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex min-w-0 max-w-full flex-wrap gap-2">
                    {data.tags.map((t) => (
                      <Badge
                        key={t}
                        variant="outline"
                        className="max-w-full whitespace-normal break-words text-left"
                      >
                        {t}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 论文轨：文章信息 + 关键词 + CLC */}
            {isPaperTrack && (
              <FoldCard title="文章信息" defaultOpen={!isMobile}>
                <CardContent>
                  <MetaItem label="年份" value={String(data.year)} />
                  <MetaItem label="来源" value={data.venue} />
                  <MetaItem label="学科" value={data.discipline} />
                  <MetaItem label="子学科" value={data.subdiscipline} />
                  <MetaItem label="站内编号" value={data.site_id} />
                  <MetaItem label="语言" value={languageLabel(data.language)} />
                  {data.keywords && data.keywords.length > 0 && (
                    <MetaItem label="关键词" value={data.keywords.join('；')} />
                  )}
                  {data.clc_code && (
                    <MetaItem label="中图分类号" value={`${data.clc_code}${data.clc_label ? ` · ${data.clc_label}` : ''}`} />
                  )}
                  {canSeeScores && data.quality_score != null && (
                    <MetaItem
                      label="评分"
                      hint="百分制：90+ 顶刊级；80+ Q1；70+ Q2；60+ Q3；50+ Q4；低于 50 记为 R（未达发表线）。"
                      value={
                        <>
                          {data.quality_score.toFixed(1)}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">/ 100</span>
                          {(() => {
                            const g = qualityGrade(data.quality_grade, data.quality_score)
                            return g ? (
                              <span className="ml-1.5 text-xs font-normal text-muted-foreground" title={g.description}>
                                {g.label}
                              </span>
                            ) : null
                          })()}
                        </>
                      }
                    />
                  )}
                  {data.r_factor != null && (
                    <MetaItem
                      label="站内热度"
                      hint="R 值：阅读、收藏、评论的站内加权，只反映站内关注度，不计入学术评分。"
                      value={data.r_factor.toFixed(1)}
                    />
                  )}
                  <MetaItem label="ISBN" value={data.isbn} />
                </CardContent>
              </FoldCard>
            )}


            <FoldCard title="阅读与影响" defaultOpen={false}>
              <CardContent>
                {isPaperTrack && (
                  <>
                    <MetaItem label="R 指数" value={data.r_index != null ? String(data.r_index) : '—'} />
                    {canSeeScores && (
                      <MetaItem label="学科分区" value={data.quartile ?? '样本不足'} />
                    )}
                  </>
                )}
                <MetaItem label="阅读次数" value={String(data.reads ?? 0)} />
                <MetaItem label="下载次数" value={String(data.downloads ?? 0)} />
                <MetaItem label="收藏次数" value={String(data.saves ?? 0)} />
              </CardContent>
            </FoldCard>

            <RelatedResources resourceId={id} discipline={data.discipline} />
            <Comments resourceId={id} />
          </div>
        </div>

        {/* 右侧 sticky 侧栏：≥1280px（xl）才渲染 */}
        <aside className="article-aside sticky top-24 hidden w-72 shrink-0 self-start space-y-4 xl:block">
          {toc.length > 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <ListTree className="h-4 w-4" />
                  目录
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="max-h-[55vh] space-y-0.5 overflow-y-auto border-l border-border">
                  {toc.map((t) => (
                    <li key={t.id}>
                      <button
                        onClick={() => {
                          const el = document.getElementById(t.id)
                          if (el) {
                            const top = el.getBoundingClientRect().top + window.scrollY - 88
                            window.scrollTo({ top, behavior: 'smooth' })
                          }
                        }}
                        className={
                          'block w-full truncate rounded px-2 py-1 text-left text-xs transition-colors hover:bg-muted hover:text-primary ' +
                          (t.level === 3 ? 'pl-5 text-muted-foreground' : 'font-medium')
                        }
                        title={t.text}
                      >
                        {t.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {data.has_file && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">下载</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button asChild variant="outline" size="sm" className="w-full">
                  <a href={`/api/catalog/${id}/export?format=docx&v=27`} download>
                    <FileDown className="h-4 w-4" />
                    Word 文档（.docx）
                  </a>
                </Button>
                {isPaperTrack && (
                  <>
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <a href={`/api/catalog/${id}/export?format=pdf&v=27`} download>
                        <FileDown className="h-4 w-4" />
                        规范化 PDF
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => setPdfPreviewOpen(true)}
                    >
                      <FileText className="h-4 w-4" />
                      PDF 版式预览
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          <Dialog open={pdfPreviewOpen} onOpenChange={setPdfPreviewOpen}>
            <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none p-0 sm:h-[86vh] sm:max-h-[86vh] sm:w-full sm:max-w-5xl sm:rounded-lg">
              <DialogHeader className="border-b px-4 py-3">
                <DialogTitle className="text-sm">PDF 版式预览 · 与下载件同源</DialogTitle>
              </DialogHeader>
              <div className="min-h-0 flex-1 p-2">
                {pdfPreviewOpen && (
                  <PdfImagePreview resourceId={id} />
                )}
              </div>
            </DialogContent>
          </Dialog>

          {isAuthenticated && (
            <ArticleEngagement
              resourceId={id}
              authors={cleanAuthors.length > 0 ? cleanAuthors : data.authors}
              discipline={data.discipline}
            />
          )}

          {!isEssayTrack && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">站内引用（非学术发表）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {formatCitation(
                  { ...data, authors: cleanAuthors.length > 0 ? cleanAuthors : data.authors },
                  'gb-t-7714',
                )}
              </p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full">
                    <Quote className="h-3.5 w-3.5" />
                    复制引用格式
                    <ChevronDown className="ml-auto h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {CITATION_STYLES.map((style) => (
                    <DropdownMenuItem
                      key={style.value}
                      onClick={() => {
                        const cite = formatCitation(
                          { ...data, authors: cleanAuthors.length > 0 ? cleanAuthors : data.authors },
                          style.value,
                        )
                        if (!navigator.clipboard?.writeText) {
                          toast.error('当前浏览器不支持自动复制，请手动选择')
                          return
                        }
                        void navigator.clipboard.writeText(cite).then(
                          () => toast.success(`${style.label} 引用已复制`),
                          () => toast.error('复制失败，请手动选择'),
                        )
                      }}
                    >
                      {style.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <div className="grid grid-cols-2 gap-2">
                <Button asChild variant="ghost" size="sm">
                  <a href={`/api/export?ids=${id}&format=bibtex`} download>
                    BibTeX
                  </a>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <a href={`/api/export?ids=${id}&format=ris`} download>
                    RIS
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
          )}

          {!isEssayTrack && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">文章信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs">
              <MetaItem label="站内路径" value={`/catalog/${data.id}`} />
              <MetaItem label="页码" value={data.pages || '—'} />
              <MetaItem label="站内编号" value={data.site_id || '—'} />
              
              <MetaItem label="年份" value={String(data.year)} />
              {isPaperTrack && data.clc_code && (
                <MetaItem label="中图分类号" value={`${data.clc_code}${data.clc_label ? ` · ${data.clc_label}` : ''}`} />
              )}
              {canSeeScores && isPaperTrack && data.quality_score != null && (
                <MetaItem
                  label="评分"
                  value={`${data.quality_score.toFixed(1)}${data.quality_grade ? `（${data.quality_grade}）` : ''}`}
                />
              )}
              {isPaperTrack && data.r_factor != null && (
                <MetaItem label="站内热度" value={data.r_factor.toFixed(1)} />
              )}
            </CardContent>
          </Card>
          )}

          <DeclarationsCard data={data} />
          {historyQ.data && <PublicHistoryCard history={historyQ.data} />}

          {isAuthenticated ? (
            <Button variant="outline" size="sm" className="w-full" onClick={() => setListOpen(true)}>
              <Bookmark className="h-3.5 w-3.5" />
              加入阅读列表
            </Button>
          ) : (
            <p className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              游客模式：可阅读与下载全部已刊内容。
              <Link to="/login" search={{ redirect: `/catalog/${id}` }} className="text-primary hover:underline">
                登录
              </Link>
              后可收藏并参与评论。
            </p>
          )}

          {isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full text-muted-foreground">
                  <MoreVertical className="h-4 w-4" />
                  管理此条
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil className="h-4 w-4" />
                  编辑题录
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEventOpen(true)}>
                  <FileText className="h-4 w-4" />
                  记录更正 / 撤稿
                </DropdownMenuItem>
                {data.publication_status === 'draft' && (
                  <DropdownMenuItem
                    disabled={updateMut.isPending}
                    onClick={() => {
                      updateMut.mutate(
                        { id, body: { publication_status: 'published' } },
                        {
                          onSuccess: () => toast.success('已刊出'),
                          onError: () => toast.error('刊出失败'),
                        },
                      )
                    }}
                  >
                    <Send className="h-4 w-4" />
                    刊出
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  删除资源
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </aside>
      </div>

      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="回到顶部"
          className="fixed bottom-6 right-5 z-40 hidden h-10 w-10 items-center justify-center rounded-full border bg-background/90 text-muted-foreground shadow-md backdrop-blur transition hover:text-primary sm:flex"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}

      {/* 移动端底部浮动条：下载 / 收藏 / 更多，高 ≤56px */}
      {isMobile && (
        <MobileDetailActions
          resourceId={id}
          isAdmin={isAdmin}
          hasFile={Boolean(data.has_file)}
          externalUrl={data.external_url}
          onEdit={() => setEditOpen(true)}
          onDelete={() => setDeleteOpen(true)}
          onSave={() => setListOpen(true)}
        />
      )}

      {editOpen && data && (
        <EditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          initial={data}
          onSubmit={async (body) => {
            try {
              await updateMut.mutateAsync({ id, body })
              toast.success('已更新')
              setEditOpen(false)
            } catch (err) {
              toast.error(extractError(err, '更新失败'))
            }
          }}
        />
      )}

      {isAdmin && eventOpen && (
        <PublicEventDialog
          open={eventOpen}
          onOpenChange={setEventOpen}
          resourceId={id}
          onCreated={() => void historyQ.refetch()}
        />
      )}

      {isAuthenticated && (
        <AddToListDialog resourceId={id} open={listOpen} onOpenChange={setListOpen} />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="删除资源"
        description="确认删除该资源？此操作不可撤销。"
        confirmText="删除"
        destructive
        onOpenChange={setDeleteOpen}
        onConfirm={onDelete}
      />
    </div>
  )
}

// 管理员登记公开变更：事件只追加，读者能在文章页看到完整记录。
function PublicEventDialog({
  open,
  onOpenChange,
  resourceId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceId: number
  onCreated: () => void
}) {
  const [eventType, setEventType] = useState('correction')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      toast.error('标题与说明都必须填写')
      return
    }
    setPending(true)
    try {
      await api.post(`/catalog/${resourceId}/events`, {
        event_type: eventType,
        title: title.trim(),
        body: body.trim(),
      })
      toast.success('已记录并公开')
      setTitle('')
      setBody('')
      onCreated()
      onOpenChange(false)
    } catch (err) {
      toast.error(extractError(err, '记录失败'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>记录更正 / 撤稿 / 署名变更</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>类型</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="correction">更正</SelectItem>
                <SelectItem value="retraction">撤稿</SelectItem>
                <SelectItem value="author_change">署名变更</SelectItem>
                <SelectItem value="expression_of_concern">关注声明</SelectItem>
                <SelectItem value="version">版本说明</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="public-event-title">标题</Label>
            <Input
              id="public-event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：更正图 2 的样本量标注"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="public-event-body">公开说明</Label>
            <Textarea
              id="public-event-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="说明改了什么、为什么改、影响哪些结论。撤稿请写清原因。"
              rows={5}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? '提交中…' : '公开记录'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 扫描版 PDF 兜底卡：manuscript 409/needs_docx 时显示，禁止 pdf.js 回退。
function ScannedPdfFallback({ resourceId, hasFile }: { resourceId: number; hasFile: boolean }) {
  return (
    <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
      <CardContent className="py-6 text-center">
        <p className="text-sm font-medium">本文原件为扫描版 PDF</p>
        <p className="mt-1 text-xs text-muted-foreground">
          暂不支持在线阅读，可下载原件或等编辑部补 Word 版。
        </p>
        {hasFile && (
          <Button asChild variant="outline" size="sm" className="mt-3">
            <a href={`/api/catalog/${resourceId}/file`} download>
              <Download className="h-4 w-4" />
              下载原件
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// 公开的版本与变更记录：更正、撤稿、署名变更、作者修回版本。
// 只展示真实存在的事件；没有记录就不渲染“已核验”之类的空壳。
const PUBLIC_EVENT_LABELS: Record<string, string> = {
  correction: '更正',
  retraction: '撤稿',
  author_change: '署名变更',
  expression_of_concern: '关注声明',
  version: '版本说明',
}

function formatPublicDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function PublicHistoryCard({ history }: { history: ResourceHistory }) {
  if (history.events.length === 0 && history.versions.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">版本与公开记录</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        {history.events.map((event) => (
          <div key={event.id} className="space-y-1 border-l-2 border-primary/30 pl-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={event.event_type === 'retraction' ? 'destructive' : 'outline'}>
                {PUBLIC_EVENT_LABELS[event.event_type] ?? event.event_type}
              </Badge>
              <span className="font-medium">{event.title}</span>
              <span className="text-muted-foreground">
                {formatPublicDate(event.effective_at ?? event.created_at)}
              </span>
            </div>
            <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">{event.body}</p>
          </div>
        ))}
        {history.versions.map((version) => (
          <div key={version.version} className="flex flex-wrap gap-x-3 gap-y-1">
            <span className="font-medium">v{version.version}</span>
            <span className="text-muted-foreground">{formatPublicDate(version.created_at)}</span>
            <span className="w-full text-muted-foreground">
              {version.note?.trim() || (version.version === 1 ? '首次提交版本' : '作者修回版本')}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// 声明与许可：逐篇结构化字段，不再用全站默认许可覆盖每一篇。
// 只有真实存在字段时才渲染；没有声明就不假装“已声明”。
function DeclarationsCard({ data }: { data: ResourceResponse }) {
  const rows = [
    { label: '许可', value: data.license },
    { label: '作者贡献（CRediT）', value: data.author_contributions },
    { label: '基金与资助', value: data.funding },
    { label: '利益冲突', value: data.coi_statement },
    { label: '数据可用性', value: data.data_availability },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value?.trim()))
  if (rows.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">声明与许可</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="space-y-1">
            <div className="font-medium text-muted-foreground">{row.label}</div>
            <p className="whitespace-pre-wrap leading-relaxed">{row.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

// 编辑表单字段精简
interface EditFormState {
  title: string
  authors: string
  year: string
  discipline: string
  abstract: string
  tags: string
  preview: string
  publication_status: 'published' | 'in_review' | 'draft'
  license: string
  author_contributions: string
  funding: string
  coi_statement: string
  data_availability: string
}

function EditDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial: {
    title: string
    authors: string[]
    year: number
    discipline: string
    abstract: string
    tags: string[]
    preview: string
    publication_status: 'published' | 'in_review' | 'draft'
    license?: string | null
    author_contributions?: string | null
    funding?: string | null
    coi_statement?: string | null
    data_availability?: string | null
  }
  onSubmit: (body: ResourceUpdate) => Promise<void>
}) {
  const [form, setForm] = useState<EditFormState>({
    title: initial.title,
    authors: initial.authors.join(', '),
    year: String(initial.year),
    discipline: initial.discipline,
    abstract: initial.abstract,
    tags: initial.tags.join(', '),
    preview: initial.preview,
    publication_status: initial.publication_status,
    license: initial.license ?? '',
    author_contributions: initial.author_contributions ?? '',
    funding: initial.funding ?? '',
    coi_statement: initial.coi_statement ?? '',
    data_availability: initial.data_availability ?? '',
  })

  const onSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    const body: ResourceUpdate = {
      title: form.title,
      authors: parseListField(form.authors),
      year: Number(form.year),
      discipline: form.discipline,
      abstract: form.abstract,
      tags: parseListField(form.tags),
      preview: form.preview,
      publication_status: form.publication_status,
      license: form.license.trim() || null,
      author_contributions: form.author_contributions.trim() || null,
      funding: form.funding.trim() || null,
      coi_statement: form.coi_statement.trim() || null,
      data_availability: form.data_availability.trim() || null,
    }
    await onSubmit(body)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑资源</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmitForm} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">标题</Label>
            <Input
              id="edit-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-authors">作者（逗号分隔）</Label>
            <Input
              id="edit-authors"
              value={form.authors}
              onChange={(e) => setForm({ ...form, authors: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-year">年份</Label>
              <Input
                id="edit-year"
                type="number"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-discipline">学科</Label>
              <Input
                id="edit-discipline"
                value={form.discipline}
                onChange={(e) => setForm({ ...form, discipline: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-abstract">摘要</Label>
            <Textarea
              id="edit-abstract"
              value={form.abstract}
              onChange={(e) => setForm({ ...form, abstract: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-tags">标签（逗号分隔）</Label>
            <Input
              id="edit-tags"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-preview">预览</Label>
            <Textarea
              id="edit-preview"
              value={form.preview}
              onChange={(e) => setForm({ ...form, preview: e.target.value })}
            />
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            <div>
              <div className="text-sm font-medium">声明与许可</div>
              <p className="text-xs text-muted-foreground">
                逐篇保存，不再只埋在 PDF 里；留空显示“未声明”。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-license">许可</Label>
              <Input
                id="edit-license"
                value={form.license}
                onChange={(e) => setForm({ ...form, license: e.target.value })}
                placeholder="CC BY-NC 4.0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-contributions">作者贡献（CRediT）</Label>
              <Textarea
                id="edit-contributions"
                value={form.author_contributions}
                onChange={(e) => setForm({ ...form, author_contributions: e.target.value })}
                placeholder="概念化、方法学、写作……"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-funding">基金与资助</Label>
              <Textarea
                id="edit-funding"
                value={form.funding}
                onChange={(e) => setForm({ ...form, funding: e.target.value })}
                placeholder="资助方、项目编号；无则写“无”"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-coi">利益冲突声明</Label>
              <Textarea
                id="edit-coi"
                value={form.coi_statement}
                onChange={(e) => setForm({ ...form, coi_statement: e.target.value })}
                placeholder="作者声明无利益冲突"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-data">数据可用性</Label>
              <Textarea
                id="edit-data"
                value={form.data_availability}
                onChange={(e) => setForm({ ...form, data_availability: e.target.value })}
                placeholder="数据位置、获取方式或受限说明"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-pubstatus">刊出状态</Label>
            <Select
              value={form.publication_status}
              onValueChange={(v) =>
                setForm({ ...form, publication_status: v as EditFormState['publication_status'] })
              }
            >
              <SelectTrigger id="edit-pubstatus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                  <SelectItem value="published">已发表（公开可见）</SelectItem>
                  <SelectItem value="in_review">评审中（刊前预览）</SelectItem>
                  <SelectItem value="draft">草稿（仅编辑部可见）</SelectItem>
                </SelectContent>
              </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// 摘要卡：可折叠，默认展开；科普轨标题写"导语"，论文轨写"摘要"。
function AbstractCard({ text, collapsible, label = '摘要' }: { text: string; collapsible: boolean; label?: string }) {
  const body = normalizeAbstract(text)
  const [open, setOpen] = useState(!collapsible)
  const [overflowing, setOverflowing] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (ref.current) {
      setOverflowing(ref.current.scrollHeight > ref.current.clientHeight + 4)
    }
  }, [text])

  return (
    <section className="mb-6 border-l-2 border-primary/30 pl-4 sm:pl-5">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
        {label}
      </p>
      <p
        ref={ref}
        className={
          'text-sm leading-7 whitespace-pre-wrap' +
          (collapsible && !open ? ' line-clamp-5' : '')
        }
      >
        {body}
      </p>
      {collapsible && (overflowing || !open) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 inline-flex min-h-[36px] items-center text-xs font-medium text-primary hover:underline"
        >
          {open ? '收起' : '展开全文'}
        </button>
      )}
    </section>
  )
}

// 可折叠信息卡
function FoldCard({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details open={defaultOpen} className="fold-card group border-t">
      <summary className="flex min-h-[48px] cursor-pointer select-none items-center justify-between gap-2 py-3 text-sm font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  )
}

// 移动端底部固定操作栏：下载 / 收藏 / 更多，高 ≤56px。
function MobileDetailActions({
  resourceId,
  isAdmin,
  hasFile,
  externalUrl,
  onEdit,
  onDelete,
  onSave,
}: {
  resourceId: number
  isAdmin: boolean
  hasFile: boolean
  externalUrl?: string | null
  onEdit: () => void
  onDelete: () => void
  onSave: () => void
}) {
  const [moreOpen, setMoreOpen] = useState(false)
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-center gap-2 border-t bg-background/95 px-3 backdrop-blur">
        {hasFile && (
          <Button asChild variant="ghost" size="sm" className="flex-1 gap-1">
            <a href={`/api/catalog/${resourceId}/export?format=docx&v=27`} download aria-label="下载 Word">
              <FileDown className="h-4 w-4" />
              下载
            </a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 gap-1"
          onClick={onSave}
          aria-label="收藏"
        >
          <Bookmark className="h-4 w-4" />
          收藏
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 gap-1"
          aria-label="更多操作"
          onClick={() => setMoreOpen(true)}
        >
          <MoreVertical className="h-4 w-4" />
          更多
        </Button>
      </div>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="更多操作">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={async () => {
              setMoreOpen(false)
              try {
                await navigator.clipboard.writeText(window.location.href)
                toast.success('链接已复制')
              } catch {
                toast.error('复制失败')
              }
            }}
            className="flex min-h-[48px] items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-accent"
          >
            <Share2 className="h-5 w-5 shrink-0 text-muted-foreground" />
            复制分享链接
          </button>
          {externalUrl && (
            <a
              href={safeHref(externalUrl)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMoreOpen(false)}
              className="flex min-h-[48px] items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-accent"
            >
              <ExternalLink className="h-5 w-5 shrink-0 text-muted-foreground" />
              外部链接
            </a>
          )}
          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false)
                  onEdit()
                }}
                className="flex min-h-[48px] items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-accent"
              >
                <Pencil className="h-5 w-5 shrink-0 text-muted-foreground" />
                编辑
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false)
                  onDelete()
                }}
                className="flex min-h-[48px] items-center gap-3 rounded-md px-2 text-left text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-5 w-5 shrink-0" />
                删除
              </button>
            </>
          )}
        </div>
      </BottomSheet>
    </>
  )
}

// 作者行：v5 用 authors_detail 渲染。第一作者 †、通讯 ✉、已认领徽标；
// 未认领者邮箱/单位一律不展示（防 PDF 抓私人邮箱）。
function AuthorRow({ detail, fallbackNames }: { detail: AuthorDetail[] | null; fallbackNames: string[] }) {
  if (detail && detail.length > 0) {
    const sorted = [...detail].sort((a, b) => a.order - b.order)
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {sorted.map((a, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className="text-foreground">{a.name}</span>
            {a.roles.includes('first') && <sup title="第一作者">†</sup>}
            {a.roles.includes('corresponding') && <sup title="通讯作者">✉</sup>}
            {a.claimed && (
              <Badge variant="secondary" className="ml-0.5 text-[10px]">已认领</Badge>
            )}
            {i < sorted.length - 1 && <span className="ml-2 text-border">·</span>}
          </span>
        ))}
      </div>
    )
  }
  // 兜底：无 authors_detail 时用 authors 数组（不显示邮箱）。
  // 数组顺序就是署名顺序：第一位补 †（第一作者），避免读者只看到一串
  // 名字、分不清谁是一作；后续作者用「·」分隔，与 detail 分支保持一致。
  return fallbackNames.length > 0 ? (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      {fallbackNames.map((name, i) => (
        <span key={`${name}-${i}`} className="inline-flex items-center gap-1">
          <span className="text-foreground">{name}</span>
          {i === 0 && <sup title="第一作者">†</sup>}
          {i < fallbackNames.length - 1 && <span className="ml-1 text-border">·</span>}
        </span>
      ))}
    </div>
  ) : null
}

// 相关文章
function RelatedResources({
  resourceId,
  discipline,
}: {
  resourceId: number
  discipline?: string | null
}) {
  const { data: sameDiscipline } = useResources({
    page: 1,
    page_size: 8,
    discipline: discipline ?? undefined,
  })
  const { data: fallback } = useResources({ page: 1, page_size: 8 })
  const pool =
    (sameDiscipline?.data ?? []).filter((r) => r.id !== resourceId).length >= 1
      ? (sameDiscipline?.data ?? [])
      : (fallback?.data ?? [])
  const items = pool.filter((r) => r.id !== resourceId).slice(0, 4)
  if (items.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">相关文章</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((r) => (
          <Link
            key={r.id}
            to="/catalog/$resourceId"
            params={{ resourceId: String(r.id) }}
            className="group block rounded-md border-b pb-2 last:border-0 last:pb-0"
          >
            <p className="line-clamp-2 text-sm font-medium leading-snug transition-colors group-hover:text-primary">
              {r.title}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {(() => {
                const clean = sanitizeAuthors(r.authors)
                return (
                  <>
                    {clean.slice(0, 2).join('、')}
                    {clean.length > 2 ? ' 等' : ''} · {r.year}
                  </>
                )
              })()}
            </p>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
