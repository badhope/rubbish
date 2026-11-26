import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock3, Flame, Flag, Lock, Megaphone, MessageSquare, Pin, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { uploadForumImage } from '@/lib/forum'
import { extractError } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Pagination } from '@/components/common/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { FORUM_COPY } from '@/lib/forum-copy'
import { ModerationBadge } from '@/components/forum/moderation-status'

const ForumEditor = lazy(() =>
  import('@/components/forum/forum-editor').then((m) => ({ default: m.ForumEditor })),
)
const FeedbackBoardPage = lazy(() =>
  import('@/components/forum/feedback-board').then((m) => ({ default: m.FeedbackBoardPage })),
)

export const Route = createFileRoute('/forum/')({
  component: ForumListPage,
})

interface ForumTopic {
  id: number
  title: string
  body: string
  category: string
  board_id: number | null
  board_slug: string | null
  board_name: string | null
  is_fictional: boolean
  board_path: string | null
  is_pinned: boolean
  is_locked: boolean
  reply_count: number
  created_at: string
  last_reply_at: string | null
  paper_id: number | null
  moderation_status?: string | null
  risk_score?: number | null
  review_eta_at?: string | null
  author: { id: number; username: string; display_name?: string | null; avatar_url?: string | null } | null
}

interface BoardNode {
  id: number
  parent_id: number | null
  slug: string
  name: string
  description: string | null
  topics: number
  total_topics: number
  last_active: string | null
  children: BoardNode[]
}

/** 旧分类到新版块 slug 的兼容映射：老链接和旧客户端不 404。 */
const LEGACY_SLUG: Record<string, string> = {
  research: 'records',
  planning: 'records',
  'lab-notes': 'records',
  'field-notes': 'records',
  failures: 'records',
  survival: 'life',
  announcements: 'site',
  feedback: 'site',
  paper: 'discussion',
  'paper-reading': 'discussion',
  'paper-repro': 'discussion',
  method: 'discussion',
  writing: 'discussion',
  stats: 'discussion',
  question: 'discussion',
  meta: 'site',
  notice: 'site',
  suggestion: 'site',
}

function collectBoards(nodes: BoardNode[], depth = 0): Array<BoardNode & { depth: number; path: string }> {
  return nodes.flatMap((node) => [
    { ...node, depth, path: `${'　'.repeat(depth)}${depth ? '└ ' : ''}${node.name}` },
    ...collectBoards(node.children, depth + 1),
  ])
}

const CATEGORY_STYLE: Record<string, string> = {
  discussion: 'border-primary/25 bg-primary/10 text-primary',
  records: 'bg-muted text-foreground border-border',
  collab: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  life: 'bg-muted text-foreground border-border',
  site: 'border-primary/25 bg-primary/10 text-primary',
  // 旧话题未回填前的兜底
  research: 'bg-muted text-foreground border-border',
  planning: 'bg-muted text-foreground border-border',
  'lab-notes': 'bg-muted text-foreground border-border',
  'field-notes': 'bg-muted text-foreground border-border',
  failures: 'bg-muted text-foreground border-border',
  survival: 'bg-muted text-foreground border-border',
  announcements: 'border-primary/25 bg-primary/10 text-primary',
  feedback: 'bg-muted text-foreground border-border',
  paper: 'bg-muted text-foreground border-border',
  method: 'bg-muted text-foreground border-border',
  meta: 'border-primary/25 bg-primary/10 text-primary',
  notice: 'border-primary/25 bg-primary/10 text-primary',
  question: 'bg-muted text-foreground border-border',
  suggestion: 'bg-muted text-foreground border-border',
}

const CATEGORY_LABEL: Record<string, string> = {
  discussion: '写作讨论',
  records: '记录与复盘',
  collab: '组队招募',
  life: '创作生活',
  site: '站务与反馈',
  // 旧话题未回填前的兜底
  research: '记录与复盘',
  planning: '记录与复盘',
  'lab-notes': '记录与复盘',
  'field-notes': '记录与复盘',
  failures: '记录与复盘',
  survival: '创作生活',
  announcements: '站务与反馈',
  feedback: '站务与反馈',
  paper: '写作讨论',
  method: '写作讨论',
  meta: '站务与反馈',
  notice: '站务与反馈',
  question: '写作讨论',
  suggestion: '站务与反馈',
}

/** 相对时间：讨论列表的活跃信号比绝对时间更直观。 */
function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const minutes = Math.floor((Date.now() - t) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

function plainExcerpt(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_~`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const FORUM_DRAFT_KEY = 'rubbish:forum-draft:v1'

interface ForumDraft {
  title: string
  body: string
  board_id: number | null
  paper_id: number | null
  is_fictional: boolean
}

function readForumDraft(): ForumDraft | null {
  try {
    const raw = window.localStorage.getItem(FORUM_DRAFT_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ForumDraft>
    if (typeof value.title !== 'string' || typeof value.body !== 'string') return null
    return {
      title: value.title,
      body: value.body,
      board_id: typeof value.board_id === 'number' ? value.board_id : null,
      paper_id: typeof value.paper_id === 'number' ? value.paper_id : null,
      is_fictional: value.is_fictional === true,
    }
  } catch {
    return null
  }
}

function saveForumDraft(draft: ForumDraft) {
  try {
    if (!draft.title.trim() && !draft.body.trim()) {
      window.localStorage.removeItem(FORUM_DRAFT_KEY)
      return
    }
    window.localStorage.setItem(FORUM_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // 本机存储不可用时，草稿自动保存静默降级。
  }
}

function ForumListPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { isAuthenticated } = useAuth()
  const search = useSearch({ strict: false }) as {
    category?: string
    page?: number
    paperId?: number | string
    paperTitle?: string
    prompt?: string
    sort?: string
    q?: string
    view?: string
    compose?: number
  }
  const view = search.view === 'feedback' ? 'feedback' : 'list'
  const category = search.category ?? 'all'
  const page = search.page ?? 1
  const sort = search.sort === 'hot' ? 'hot' : 'latest'
  const keyword = search.q ?? ''
  const [queryInput, setQueryInput] = useState(keyword)

  useEffect(() => {
    setQueryInput(keyword)
  }, [keyword])

  const paperId = search.paperId ? Number(search.paperId) : null
  const paperTitle = search.paperTitle ?? ''
  const discussionPrompt = search.prompt?.trim() ?? ''
  const paperDraftBody = (pid: number) =>
    `作品链接：/catalog/${pid}\n\n${
      discussionPrompt ? `先回应这个问题：${discussionPrompt}\n\n` : ''
    }`

  const [open, setOpen] = useState(false)
  const [boardPickerOpen, setBoardPickerOpen] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [form, setForm] = useState({
    title: paperId ? `讨论：${(paperTitle || `作品 #${paperId}`).slice(0, 170)}` : '',
    body: paperId ? paperDraftBody(paperId) : '',
    board_id: null as number | null,
    paper_id: paperId,
    is_fictional: false,
  })
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)

  useEffect(() => {
    if (!open) return
    const hasText = form.title.trim().length > 0 || form.body.trim().length > 0
    if (!hasText) {
      setDraftSavedAt(null)
      return
    }
    const timer = window.setTimeout(() => {
      saveForumDraft(form)
      setDraftSavedAt(new Date())
    }, 400)
    return () => window.clearTimeout(timer)
  }, [form, open])

  const boardsQ = useQuery({
    queryKey: ['forum', 'boards'],
    queryFn: async () => (await api.get('/forum/boards')).data,
  })
  const boardTree: BoardNode[] = boardsQ.data?.tree ?? []
  const allBoards = collectBoards(boardTree)
  const leafBoards = allBoards.filter((b) => b.children.length === 0)

  // 不强制用户选分区：留空时由后端按标题/正文自动归类，降低发帖门槛。
  const normalizedCategory = LEGACY_SLUG[category] ?? category
  const activeBoard = normalizedCategory === 'all' ? null : allBoards.find((b) => b.slug === normalizedCategory)

  const listQ = useQuery({
    queryKey: ['forum', 'topics', category, page, sort, keyword],
    queryFn: async () =>
      (
        await api.get('/forum/topics', {
          // 新版树形版块用 board（父板块聚合后代），旧分类别名仍可用 category。
          params: {
            ...(category === 'all' ? {} : { board: normalizedCategory }),
            page,
            page_size: 20,
            sort,
            ...(keyword ? { q: keyword } : {}),
          },
        })
      ).data,
  })

  const createMut = useMutation({
    mutationFn: async () => (await api.post('/forum/topics', form)).data,
    onSuccess: (data: ForumTopic) => {
      if (data.moderation_status === 'manual_review' || data.moderation_status === 'pending') {
        const minutes = data.review_eta_at
          ? Math.max(1, Math.round((new Date(data.review_eta_at).getTime() - Date.now()) / 60000))
          : 30
        toast.success(`主题帖已提交，进入运营人工核验，预计 ${minutes} 分钟内完成。`)
      } else {
        toast.success('主题帖已自动归类并公开。')
      }
      void qc.invalidateQueries({ queryKey: ['forum'] })
      setOpen(false)
      setForm({ title: '', body: '', board_id: null, paper_id: null, is_fictional: false })
      setDraftSavedAt(null)
      try {
        window.localStorage.removeItem(FORUM_DRAFT_KEY)
      } catch {
        // ignore
      }
      void navigate({ to: '/forum/$topicId', params: { topicId: String(data.id) } })
    },
    onError: (err) => toast.error(extractError(err, '发送失败')),
  })

  const reportMut = useMutation({
    mutationFn: async (target: { topic_id: number; reason?: string }) =>
      (await api.post('/forum/reports', target)).data,
    onSuccess: () => toast.success('已举报，站务会尽快处理'),
    onError: (err) => toast.error(extractError(err, '举报失败')),
  })

  const publishTopic = () => {
    if (
      createMut.isPending ||
      form.title.trim().length < 2 ||
      form.body.trim().length < 2
    ) {
      return
    }
    createMut.mutate()
  }

  const openComposer = () => {
    if (!isAuthenticated) {
      void navigate({ to: '/login', search: { redirect: '/forum' } })
      return
    }
    const stored = paperId ? null : readForumDraft()
    const usableDraft = stored?.paper_id === null ? stored : null
    const storedBoardId =
      usableDraft?.board_id && leafBoards.some((b) => b.id === usableDraft.board_id)
        ? usableDraft.board_id
        : null
    setForm({
      title: paperId
        ? `讨论：${(paperTitle || `作品 #${paperId}`).slice(0, 170)}`
        : usableDraft?.title ?? '',
      body: paperId
        ? paperDraftBody(paperId)
        : usableDraft?.body ?? '',
      board_id: storedBoardId,
      paper_id: paperId,
      is_fictional: usableDraft?.is_fictional ?? false,
    })
    setBoardPickerOpen(false)
    setOpen(true)
  }

  useEffect(() => {
    if (search.compose !== 1) return
    if (!isAuthenticated) {
      void navigate({ to: '/login', search: { redirect: '/forum?compose=1' } })
      return
    }
    openComposer()
    // openComposer 每次渲染都会重新创建；只在 compose 参数变化时触发一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.compose, isAuthenticated])

  const updateSearch = (patch: Record<string, unknown>) => {
    void navigate({ to: '/forum', search: { ...search, ...patch }, replace: true })
  }

  const selectedBoard = allBoards.find((b) => b.id === form.board_id)
  const topics: ForumTopic[] = listQ.data?.data ?? []
  const meta = listQ.data?.meta

  if (view === 'feedback') {
    return (
      <Suspense fallback={<Loading />}>
        <FeedbackBoardPage />
      </Suspense>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <PageHeader
        title="主题论坛"
        description="写法、复盘、组队，以及写作之外的生活。登录即可发布主题帖，不必攒经验。"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/forum" search={{ view: 'feedback' }}>
                <MessageSquare className="h-4 w-4" />
                反馈墙
              </Link>
            </Button>
            <Button onClick={openComposer}>
              <Plus className="h-4 w-4" />
              发布主题帖
            </Button>
          </div>
        }
      />

      {!activeBoard && !keyword ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary/50 bg-muted/25 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-primary">这周写什么</p>
            <p className="mt-1 font-serif text-base leading-snug">你最近一次推翻重写，是因为什么？</p>
          </div>
          <Button size="sm" variant="outline" onClick={openComposer}>
            参与楼层互动
          </Button>
        </div>
      ) : null}

      {paperId ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span className="min-w-0">
              正在围绕一篇作品
              <Link
                to="/catalog/$resourceId"
                params={{ resourceId: String(paperId) }}
                className="mx-1 font-medium text-primary hover:underline"
              >
                {paperTitle || `#${paperId}`}
              </Link>
              发起讨论。
            </span>
            <Button
              size="sm"
              onClick={openComposer}
            >
              <Plus className="h-4 w-4" />
              发布主题帖
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-y py-2.5">
        <form
          className="relative w-full sm:w-[230px]"
          onSubmit={(e) => {
            e.preventDefault()
            updateSearch({ q: queryInput.trim() || undefined, page: 1 })
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="搜索标题或正文"
            aria-label="搜索主题帖"
            className="h-8 pl-8 pr-8 text-xs"
          />
          {queryInput ? (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setQueryInput('')
                updateSearch({ q: undefined, page: 1 })
              }}
              aria-label="清除搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </form>
        <div className="flex w-full flex-wrap items-center gap-1 pb-0.5 sm:w-auto sm:flex-1 sm:flex-nowrap sm:overflow-x-auto">
          <button
            type="button"
            aria-pressed={!activeBoard}
            onClick={() => updateSearch({ category: undefined, page: 1 })}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1 text-[11px] transition-colors',
              !activeBoard
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'bg-muted/30 text-muted-foreground hover:text-foreground',
            )}
          >
            全部
          </button>
          {boardTree.map((root) => (
            <button
              key={root.slug}
              type="button"
              aria-pressed={normalizedCategory === root.slug}
              onClick={() => updateSearch({ category: root.slug, page: 1 })}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-[11px] transition-colors',
                normalizedCategory === root.slug
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'bg-muted/30 text-muted-foreground hover:text-foreground',
              )}
            >
              {root.name}
              {root.total_topics > 0 ? (
                <span className="ml-1 tabular-nums opacity-60">{root.total_topics}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-0.5 rounded-full border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => updateSearch({ sort: 'latest', page: 1 })}
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors',
              sort === 'latest'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Clock3 className="h-3 w-3" />
            最新
          </button>
          <button
            type="button"
            onClick={() => updateSearch({ sort: 'hot', page: 1 })}
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors',
              sort === 'hot'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Flame className="h-3 w-3" />
            热度
          </button>
        </div>
      </div>

      {listQ.isLoading ? (
        <Loading />
      ) : listQ.isError ? (
        <ErrorState message="加载社区失败" onRetry={() => listQ.refetch()} />
      ) : topics.length === 0 ? (
        <EmptyState
          title={keyword ? '没有找到匹配的主题帖' : '桌边还空着'}
          description={
            keyword
              ? '换个更短的关键词，或清除搜索看全部主题帖。'
              : '第一句话可以从你开始：问一个问题，或留一条建议。'
          }
          action={
            keyword ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateSearch({ q: undefined, page: 1 })}
              >
                清除搜索
              </Button>
            ) : (
              <Button size="sm" onClick={openComposer}>
                写下第一句
              </Button>
            )
          }
        />
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          {topics.map((t) => (
            <div
              key={t.id}
              className={cn(
                'flex items-start gap-3 px-4 py-4 transition-colors hover:bg-muted/20',
                // 社区公告用左侧主色条突出：公告不是普通主题帖
                (t.category === 'notice' || t.category === 'announcements') && 'border-l-4 border-l-primary',
              )}
            >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {t.is_pinned && (
                      <Badge className="gap-1 bg-primary/15 text-primary">
                        <Pin className="h-3 w-3" />
                        置顶
                      </Badge>
                    )}
                    {(t.category === 'notice' || t.category === 'announcements') ? (
                      <Badge className="gap-1 border border-transparent bg-primary text-primary-foreground">
                        <Megaphone className="h-3 w-3" />
                        社区公告
                      </Badge>
                    ) : (
                      <Badge variant="outline" className={CATEGORY_STYLE[t.category]}>
                        {t.board_name ?? CATEGORY_LABEL[t.category] ?? t.category}
                      </Badge>
                    )}
                    {t.is_fictional ? (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                        虚构
                      </Badge>
                    ) : null}
                    {t.is_locked && (
                      <Badge variant="secondary" className="gap-1">
                        <Lock className="h-3 w-3" />
                        已锁定
                      </Badge>
                    )}
                    <Link
                      to="/forum/$topicId"
                      params={{ topicId: String(t.id) }}
                      className="text-[15px] font-semibold leading-6 hover:text-primary hover:underline"
                    >
                      {t.title}
                    </Link>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-muted-foreground">
                    {plainExcerpt(t.body)}
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {t.author?.display_name || t.author?.username || '已注销用户'} · 最后活跃{' '}
                    {fmtRelative(t.last_reply_at ?? t.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <ModerationBadge status={t.moderation_status} />
                  <div className="flex items-center gap-1 rounded-full bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span className="tabular-nums">{t.reply_count}</span>
                  </div>
                </div>
                {isAuthenticated && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        aria-label="举报"
                      >
                        <Flag className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {['垃圾广告', '不友善内容', '违法违规', '其他'].map((reason) => (
                        <DropdownMenuItem
                          key={reason}
                          onClick={() => reportMut.mutate({ topic_id: t.id, reason })}
                        >
                          {reason}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
            </div>
          ))}
        </div>
      )}

      {meta && meta.total_pages > 1 && (
        <Pagination
          page={meta.page}
          totalPages={meta.total_pages}
          onPageChange={(p) => updateSearch({ page: p })}
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="forum-writing-desk top-0 left-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:inset-auto sm:top-[50dvh] sm:left-1/2 sm:h-[min(90dvh,900px)] sm:max-h-[min(90dvh,900px)] sm:max-w-[1100px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            titleRef.current?.focus()
          }}
        >
          <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">新主题帖</p>
              <DialogTitle className="mt-1 font-serif text-xl tracking-tight">写一个新主题帖</DialogTitle>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="关闭说话">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-[780px] space-y-5 py-2">
              <div className="grid grid-cols-3 gap-1.5 rounded-xl border bg-muted/25 p-2 text-[11px] text-muted-foreground">
                {['1 写主题帖', '2 预览确认', '3 自动流转'].map((label, index) => (
                  <div key={label} className="flex items-center gap-1.5 rounded-lg bg-background px-2 py-1.5">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{index + 1}</span>
                    {label}
                  </div>
                ))}
              </div>
              <input
                ref={titleRef}
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                maxLength={200}
                placeholder="标题：这个主题帖想聊什么"
                aria-label="主题帖标题"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    bodyRef.current?.focus()
                  }
                }}
                className="w-full border-0 bg-transparent p-0 font-serif text-2xl leading-tight tracking-tight outline-none placeholder:text-muted-foreground/70"
              />

              <div className="flex flex-wrap items-center gap-2">
                {boardPickerOpen ? (
                  <Select
                    value={form.board_id ? String(form.board_id) : ''}
                    onValueChange={(v) => {
                      setForm((p) => ({ ...p, board_id: Number(v) }))
                      setBoardPickerOpen(false)
                    }}
                  >
                    <SelectTrigger className="h-8 w-full text-xs" aria-label="选择分区">
                      <SelectValue placeholder="可留空，系统会自动归类" />
                    </SelectTrigger>
                    <SelectContent>
                      {leafBoards.map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.path}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <button
                    type="button"
                    onClick={() => setBoardPickerOpen(true)}
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors hover:border-primary/40"
                  >
                    <span className="text-muted-foreground">分区：</span>
                    <span className="font-medium">{selectedBoard?.name ?? '选择分区'}</span>
                    <span className="text-primary">{selectedBoard ? '修改' : '手动选择'}</span>
                  </button>
                )}
                <span className="text-[11px] text-muted-foreground">登录即可发布，不需要经验；不选分区时系统会自动归类。</span>
                <label className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={form.is_fictional}
                    onChange={(e) => setForm((p) => ({ ...p, is_fictional: e.target.checked }))}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  这是虚构内容
                </label>
              </div>

              <Suspense fallback={<div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">编辑器加载中…</div>}>
                <ForumEditor
                  value={form.body}
                  onChange={(body) => setForm((p) => ({ ...p, body }))}
                  onUploadImage={uploadForumImage}
                  minHeight={520}
                  textareaRef={bodyRef}
                  onSubmitShortcut={publishTopic}
                  placeholder="把背景、过程、你的判断写清楚；想问什么，也一起写。支持标题、引用、列表、表情和图片。"
                />
              </Suspense>
            </div>
          </div>

          <div className="border-t px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">
                {draftSavedAt ? `${FORUM_COPY.draftSaved} · ${draftSavedAt.toLocaleTimeString()}` : FORUM_COPY.draftSaved}
                {' · '}Ctrl / ⌘ + Enter 发布 · 正文 {form.body.length} 字
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={publishTopic}
                  disabled={createMut.isPending || form.title.trim().length < 2 || form.body.trim().length < 2}
                >
                  {createMut.isPending ? '提交中…' : '发布主题帖'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { CATEGORY_LABEL, CATEGORY_STYLE }
