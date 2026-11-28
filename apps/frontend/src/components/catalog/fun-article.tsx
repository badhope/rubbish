import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import axios from 'axios'
import {
  Bookmark,
  ChevronLeft,
  FileDown,
  FileText,
  LogIn,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { ResourceResponse } from '@/lib/types'
import { downloadCatalogArtifactWithFeedback } from '@/lib/catalog-download'
import { essayGenreMeta } from '@/lib/essay-genres'
import { cn, formatAuthors } from '@/lib/utils'
import {
  detectLang,
  paragraphChoices,
  topicsByPassage,
  type MarginTopic,
  type ParagraphChoice,
  type Passage,
} from '@/lib/margins'
import { useAuth } from '@/hooks/use-auth'
import { useWorkMargins } from '@/hooks/api/use-work-margins'
import { ManuscriptView } from '@/components/common/manuscript-view'
import { Comments } from '@/components/common/comments'
import { MarginLayer } from '@/components/margins/margin-layer'
import { MarginComposer } from '@/components/margins/margin-composer'
import { MarginsSection, MarginThreadsSheet } from '@/components/margins/margins-section'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import PdfImagePreview from '@/components/pdf-image-preview'

// 自由创作详情页（v1.16）：和研究长文详情页不是同一套排版。
// 研究长文页是“看一份记录”：概要卡、分类、引用、PDF、整理信息、站内热度；
// 自由创作页是“看一篇作品”：大标题、作者、封面、正文、标签、回应。
// 这里刻意不渲染任何研究块，也不使用研究长文页的封面卡与侧栏。
//
// 1.21 页边：读者选中正文里的一句话就能提问。问题是一条普通的主题帖
// （论坛的核验、回应、关注、通知照旧），只是多带一段原文引文，
// 于是它能回到这句话旁边：桌面在右侧页边，手机在左侧小标记和文末列表。

function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia?.(query)
    if (!mql) return
    const on = () => setMatches(mql.matches)
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [query])
  return matches
}

function topicGroupKey(topic: MarginTopic): string | null {
  if (!topic.passage?.quote) return null
  return topicsByPassage([topic]).anchored[0]?.key ?? null
}

interface FunArticleProps {
  data: ResourceResponse
  progress: number
  isAdmin: boolean
  saved: boolean
  onEdit: () => void
  onDelete: () => void
  onSave: () => void
}

export function FunArticle({
  data,
  progress,
  isAdmin,
  saved,
  onEdit,
  onDelete,
  onSave,
}: FunArticleProps) {
  const genre = essayGenreMeta(data.content_genre)
  const [fatal, setFatal] = useState<unknown>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const author = data.authors_detail?.[0]
  const authorName = author?.name || formatAuthors(data.authors) || '佚名'
  const initial = authorName.trim().slice(0, 1).toUpperCase()

  // —— 页边 ——
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const search = useSearch({ strict: false }) as { passage?: number | string }
  const wide = useMinWidth(1280)
  const marginsQ = useWorkMargins(data.id, true)
  const grouped = useMemo(() => topicsByPassage(marginsQ.data ?? []), [marginsQ.data])
  const [articleEl, setArticleEl] = useState<HTMLElement | null>(null)
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null)
  const [located, setLocated] = useState<string[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [sheetKey, setSheetKey] = useState<string | null>(null)
  const [composer, setComposer] = useState<{ open: boolean; passage: Passage | null; pick: boolean }>({
    open: false,
    passage: null,
    pick: false,
  })
  const [choices, setChoices] = useState<ParagraphChoice[]>([])
  const [draftPassage, setDraftPassage] = useState<Passage | null>(null)
  const bodyReady = articleEl !== null && !fatal
  const canWrite = isAuthenticated
  const showRail = wide && bodyReady && isAuthenticated
  const workLang = articleEl?.lang || detectLang(`${data.title} ${data.abstract ?? ''}`)
  // 游客读不到正文（海外匿名只开放元数据与论坛）：别说“打不开”，告诉他登录就能读。
  const guestBlocked =
    !!fatal &&
    axios.isAxiosError(fatal) &&
    (fatal.response?.status === 401 || fatal.response?.status === 403)
  const marginCount = marginsQ.data?.length ?? 0

  const openComposer = useCallback(
    (passage: Passage | null, options?: { pick?: boolean }) => {
      if (!isAuthenticated) {
        void navigate({ to: '/login', search: { redirect: location.pathname } })
        return
      }
      setSheetKey(null)
      setChoices(articleEl ? paragraphChoices(articleEl) : [])
      setComposer({ open: true, passage, pick: !!options?.pick })
    },
    [articleEl, isAuthenticated, location.pathname, navigate],
  )

  const onLocated = useCallback((keys: string[]) => {
    setLocated((prev) =>
      prev.length === keys.length && keys.every((k, i) => prev[i] === k) ? prev : keys,
    )
  }, [])
  const clearFocus = useCallback(() => setFocusKey(null), [])
  const scrollToMargins = useCallback((topicId?: number) => {
    const row = topicId
      ? document.querySelector<HTMLElement>(`[data-margin-whole="${topicId}"]`)
      : null
    ;(row ?? document.getElementById('margins'))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ?passage=<topicId>：讨论页“在原文里读”带过来，落到那句话上。
  const deepTopic = Number(search.passage) || 0
  const [deepHandled, setDeepHandled] = useState(0)
  useEffect(() => {
    if (!deepTopic || deepHandled === deepTopic || !marginsQ.data || !bodyReady) return
    const topic = marginsQ.data.find((t) => t.id === deepTopic)
    if (!topic) return
    const key = topicGroupKey(topic)
    if (key && located.includes(key)) {
      setFocusKey(key)
      setDeepHandled(deepTopic)
      return
    }
    // 整篇讨论，或作者改过原文：落到文末页边列表里那一条。
    const timer = window.setTimeout(() => {
      scrollToMargins(topic.id)
      setDeepHandled(deepTopic)
    }, 600)
    return () => window.clearTimeout(timer)
  }, [deepTopic, deepHandled, marginsQ.data, bodyReady, located, scrollToMargins])

  return (
    <div className="-mx-4 min-h-screen bg-[#fbf8f3] pb-16 dark:bg-background sm:-mx-6">
      <div className="fixed left-0 top-0 z-50 h-[2px] w-full bg-transparent">
        <div
          className="h-full bg-amber-600 transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div
        className={cn(
          'mx-auto max-w-3xl px-4 pt-4 sm:px-6 sm:pt-6',
          // 1280px 起，正文右侧留出真正的页边，页边讨论就贴在对应句子旁边。
          showRail && 'xl:max-w-[1120px] xl:pr-[352px]',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/catalog" search={{ track: 'essay' }}
            className="inline-flex min-h-[36px] shrink-0 items-center whitespace-nowrap text-sm text-muted-foreground hover:text-amber-700"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            自由创作
          </Link>
          <div className="flex min-w-0 items-center gap-0.5">
            <Button
              variant={saved ? 'secondary' : 'ghost'}
              size="sm"
              className="h-8 shrink-0 gap-1 px-2 text-muted-foreground"
              aria-label={saved ? '已收藏，管理收藏' : '收藏'}
              onClick={onSave}
            >
              <Bookmark className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} />
              <span className="hidden sm:inline">{saved ? '已收藏' : '收藏'}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1 px-2 text-muted-foreground"
              aria-label="分享"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href)
                  toast.success('链接已复制')
                } catch {
                  toast.error('复制失败，手动复制地址栏吧')
                }
              }}
            >
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">分享</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1 px-2 text-margin-ink hover:bg-margin-wash hover:text-margin-ink"
              aria-label={marginCount ? `页边讨论 ${marginCount} 条` : '页边讨论'}
              onClick={() => scrollToMargins()}
            >
              <span
                aria-hidden
                className="inline-block h-3.5 w-[6px] rounded-[1px] border-[1.5px] border-r-0 border-current"
              />
              <span className="hidden sm:inline">页边</span>
              {marginCount ? <span className="tabular-nums">{marginCount}</span> : null}
            </Button>
            {data.has_markdown ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-muted-foreground"
                  aria-label="下载自由创作 PDF"
                  onClick={() => {
                    void downloadCatalogArtifactWithFeedback({
                      resourceId: data.id,
                      format: 'pdf',
                      title: data.title,
                    })
                  }}
                >
                  <FileDown className="h-4 w-4" />
                  PDF
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-muted-foreground"
                  aria-label="下载自由创作 Word"
                  onClick={() => {
                    void downloadCatalogArtifactWithFeedback({
                      resourceId: data.id,
                      format: 'docx',
                      title: data.title,
                    })
                  }}
                >
                  <FileDown className="h-4 w-4" />
                  Word
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-muted-foreground"
                  aria-label="PDF 版式预览"
                  onClick={() => setPreviewOpen(true)}
                >
                  <FileText className="h-4 w-4" />
                  <span className="hidden sm:inline">预览</span>
                </Button>
              </>
            ) : null}
            {isAdmin ? (
              <>
                <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 px-2" aria-label="编辑" onClick={onEdit}>
                  <Pencil className="h-4 w-4" />
                  <span className="hidden sm:inline">编辑</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 gap-1 px-2 text-destructive"
                  aria-label="删除"
                  onClick={onDelete}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">删除</span>
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <header className="mt-8">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-amber-600 px-2.5 py-1 font-medium text-white">
              {genre.emoji} {genre.label}
            </span>

            <span>{data.year}</span>
            {data.reads != null ? <span>· 阅读 {data.reads}</span> : null}
            {data.is_special_issue ? (
              <span className="rounded-full border border-rose-300 px-2 py-0.5 text-rose-700">
                长文
              </span>
            ) : null}
          </div>
          <h1
            lang={workLang}
            className="mt-4 text-balance font-serif text-[1.7rem] font-semibold leading-[1.35] tracking-tight sm:text-4xl"
          >
            {data.title}
          </h1>
          <div className="mt-5 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-amber-100 text-sm font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="min-w-0 break-words text-sm font-medium">{authorName}</p>
              <p className="text-xs text-muted-foreground">
                作者
                {author?.affiliation ? ` · ${author.affiliation}` : ''}
              </p>
            </div>
          </div>
        </header>

        <article className="mt-8" id="article">
          {fatal ? (
            guestBlocked ? (
              <Card className="border-margin-ink-soft bg-margin-paper">
                <CardContent className="space-y-3 py-8 text-center">
                  <p className="text-sm text-muted-foreground">登录后可以读全文，也能在页边提问。</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button asChild size="sm">
                      <Link to="/login" search={{ redirect: location.pathname }}>
                        <LogIn className="h-4 w-4" />
                        登录
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/register">注册</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  这篇的正文暂时打不开。可以稍后刷新，或者去主题论坛催更。
                </CardContent>
              </Card>
            )
          ) : (
            <div ref={setWrapperEl} className="relative">
              <ManuscriptView
                resourceId={data.id}
                initialPercent={progress}
                onProgress={() => {}}
                hideTocNav
                useWindowScroll
                contentCategory={data.content_category}
                contentTrack={data.content_track}
                abstract={data.abstract}
                title={data.title}
                onFatalError={setFatal}
                onArticleElement={setArticleEl}
              />
              {bodyReady ? (
                <MarginLayer
                  wrapper={wrapperEl}
                  article={articleEl}
                  groups={grouped.anchored}
                  activeKey={activeKey}
                  onActivate={setActiveKey}
                  onOpenGroup={setSheetKey}
                  onCompose={openComposer}
                  draftPassage={draftPassage}
                  canWrite={canWrite}
                  showRail={showRail}
                  workLang={workLang}
                  focusKey={focusKey}
                  onFocused={clearFocus}
                  onLocated={onLocated}
                />
              ) : null}
            </div>
          )}
        </article>

        {(data.tags?.length ?? 0) > 0 ? (
          <div className="mt-8 flex flex-wrap gap-2">
            {data.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-amber-100/80 px-3 py-1 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              >
                #{tag}
              </span>
            ))}
          </div>
        ) : null}

        <MarginsSection
          groups={grouped.anchored}
          whole={grouped.whole}
          hidden={grouped.hidden}
          located={located}
          railShowsAnchored={showRail}
          canWrite={canWrite && bodyReady}
          isAuthenticated={isAuthenticated}
          loading={marginsQ.isLoading}
          workLang={workLang}
          loginRedirect={location.pathname}
          onCompose={openComposer}
          onShowPassage={setFocusKey}
        />

        <p className="mt-8 border-t pt-4 text-[11px] leading-5 text-muted-foreground">
          自由创作：不计分、不进站内热度、不走互评；内容只代表作者本人，不代表社区立场。虚构、夸张或整活请在正文里说清楚，别让读者当真。
        </p>

        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none p-0 sm:h-[86dvh] sm:max-h-[86dvh] sm:w-full sm:max-w-5xl sm:rounded-lg">
            <DialogHeader className="border-b px-4 py-3">
              <DialogTitle className="text-sm">PDF 版式预览 · 与下载件同源</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 p-2">
              {previewOpen && <PdfImagePreview resourceId={data.id} version="21" />}
            </div>
          </DialogContent>
        </Dialog>

        <section className="mt-8 border-t pt-6">
          <h2 className="mb-4 text-sm font-medium">回应</h2>
          <Comments resourceId={data.id} title={data.title} />
        </section>

        <MarginComposer
          open={composer.open}
          onOpenChange={(open) => setComposer((prev) => ({ ...prev, open }))}
          resourceId={data.id}
          workTitle={data.title}
          workLang={workLang}
          initialPassage={composer.passage}
          startPicking={composer.pick}
          choices={choices}
          onPassageChange={setDraftPassage}
          onPublished={(topic) => {
            const key = topicGroupKey(topic)
            if (key) {
              setActiveKey(key)
              window.setTimeout(() => setFocusKey(key), 350)
            } else {
              window.setTimeout(() => scrollToMargins(topic.id), 350)
            }
          }}
        />
        <MarginThreadsSheet
          group={grouped.anchored.find((g) => g.key === sheetKey) ?? null}
          open={sheetKey !== null}
          onOpenChange={(open) => {
            if (!open) setSheetKey(null)
          }}
          canWrite={canWrite}
          workLang={workLang}
          onCompose={(passage) => openComposer(passage)}
        />
      </div>
    </div>
  )
}
