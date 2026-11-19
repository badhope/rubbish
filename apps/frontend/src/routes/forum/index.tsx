import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock3, Flame, Flag, Lock, Megaphone, MessageSquare, Pin, Plus, X } from 'lucide-react'
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

const MarkdownEditor = lazy(() =>
  import('@/components/common/markdown-editor').then((m) => ({ default: m.MarkdownEditor })),
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
  board_path: string | null
  is_pinned: boolean
  is_locked: boolean
  reply_count: number
  created_at: string
  last_reply_at: string | null
  paper_id: number | null
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
  discussion: 'paper',
  question: 'method',
  notice: 'meta',
  suggestion: 'feedback',
}

function collectBoards(nodes: BoardNode[], depth = 0): Array<BoardNode & { depth: number; path: string }> {
  return nodes.flatMap((node) => [
    { ...node, depth, path: `${'　'.repeat(depth)}${depth ? '└ ' : ''}${node.name}` },
    ...collectBoards(node.children, depth + 1),
  ])
}

const CATEGORY_STYLE: Record<string, string> = {
  paper: 'bg-muted text-foreground border-border',
  method: 'bg-muted text-foreground border-border',
  life: 'bg-muted text-foreground border-border',
  collab: 'bg-muted text-foreground border-border',
  meta: 'border-primary/25 bg-primary/10 text-primary',
  notice: 'border-primary/25 bg-primary/10 text-primary',
  discussion: 'bg-muted text-foreground border-border',
  question: 'bg-muted text-foreground border-border',
  suggestion: 'bg-muted text-foreground border-border',
}

const CATEGORY_LABEL: Record<string, string> = {
  paper: '荒诞论文体',
  method: '写作实验',
  life: '学术生存',
  collab: '共创组队',
  meta: '站务',
  notice: '公告',
  discussion: '荒诞论文体',
  question: '写作求助',
  suggestion: '建议',
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
    sort?: string
    view?: string
    compose?: string
  }
  const view = search.view === 'feedback' ? 'feedback' : 'list'
  const category = search.category ?? 'all'
  const page = search.page ?? 1
  const sort = search.sort === 'hot' ? 'hot' : 'latest'

  const paperId = search.paperId ? Number(search.paperId) : null
  const paperTitle = search.paperTitle ?? ''

  const [open, setOpen] = useState(false)
  const [boardPickerOpen, setBoardPickerOpen] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [form, setForm] = useState({
    title: paperId ? `讨论：${(paperTitle || `论文 #${paperId}`).slice(0, 170)}` : '',
    body: paperId ? `论文链接：/catalog/${paperId}\n\n` : '',
    board_id: null as number | null,
    paper_id: paperId,
  })

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => saveForumDraft(form), 400)
    return () => window.clearTimeout(timer)
  }, [form, open])

  const boardsQ = useQuery({
    queryKey: ['forum', 'boards'],
    queryFn: async () => (await api.get('/forum/boards')).data,
  })
  const boardTree: BoardNode[] = boardsQ.data?.tree ?? []
  const allBoards = collectBoards(boardTree)
  const leafBoards = allBoards.filter((b) => b.children.length === 0)
  const defaultBoardId = leafBoards.find((b) => b.slug === 'paper-reading')?.id ?? leafBoards[0]?.id ?? null
  const normalizedCategory = LEGACY_SLUG[category] ?? category
  const activeBoard = normalizedCategory === 'all' ? null : allBoards.find((b) => b.slug === normalizedCategory)

  const listQ = useQuery({
    queryKey: ['forum', 'topics', category, page, sort],
    queryFn: async () =>
      (
        await api.get('/forum/topics', {
          // 新版树形版块用 board（父板块聚合后代），旧分类别名仍可用 category。
          params:
            category === 'all'
              ? { page, page_size: 20, sort }
              : { board: normalizedCategory, page, page_size: 20, sort },
        })
      ).data,
  })

  const createMut = useMutation({
    mutationFn: async () => (await api.post('/forum/topics', form)).data,
    onSuccess: (data: ForumTopic) => {
      toast.success('已发布')
      void qc.invalidateQueries({ queryKey: ['forum'] })
      setOpen(false)
      setForm({ title: '', body: '', board_id: defaultBoardId, paper_id: null })
      try {
        window.localStorage.removeItem(FORUM_DRAFT_KEY)
      } catch {
        // ignore
      }
      void navigate({ to: '/forum/$topicId', params: { topicId: String(data.id) } })
    },
    onError: (err) => toast.error(extractError(err, '发布失败')),
  })

  const reportMut = useMutation({
    mutationFn: async (target: { topic_id: number; reason?: string }) =>
      (await api.post('/forum/reports', target)).data,
    onSuccess: () => toast.success('已举报，版主会尽快处理'),
    onError: (err) => toast.error(extractError(err, '举报失败')),
  })

  const publishTopic = () => {
    if (
      createMut.isPending ||
      !form.board_id ||
      form.title.trim().length < 2 ||
      form.body.trim().length < 2
    ) {
      return
    }
    createMut.mutate()
  }

  const currentBoardId = activeBoard
    ? activeBoard.children.length > 0
      ? collectBoards(activeBoard.children).find((b) => b.children.length === 0)?.id ?? activeBoard.id
      : activeBoard.id
    : defaultBoardId

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
        ? `讨论：${(paperTitle || `论文 #${paperId}`).slice(0, 170)}`
        : usableDraft?.title ?? '',
      body: paperId
        ? `论文链接：/catalog/${paperId}\n\n`
        : usableDraft?.body ?? '',
      board_id: storedBoardId ?? currentBoardId,
      paper_id: paperId,
    })
    setBoardPickerOpen(false)
    setOpen(true)
  }

  useEffect(() => {
    if (search.compose !== '1') return
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
        title="社区"
        description="荒诞论文体、写作实验、学术生存与站务反馈都在这里；发帖登录即可，不需要积分。"
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
              发帖
            </Button>
          </div>
        }
      />

      {paperId ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span className="min-w-0">
              正在为论文
              <Link
                to="/catalog/$resourceId"
                params={{ resourceId: String(paperId) }}
                className="mx-1 font-medium text-primary hover:underline"
              >
                {paperTitle || `#${paperId}`}
              </Link>
              开一个讨论帖。
            </span>
            <Button
              size="sm"
              onClick={openComposer}
            >
              <Plus className="h-4 w-4" />
              写第一条
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-y py-2.5">
        <Select
          value={activeBoard ? normalizedCategory : 'all'}
          onValueChange={(v) => updateSearch({ category: v === 'all' ? undefined : v, page: 1 })}
        >
          <SelectTrigger className="h-8 w-[210px] text-xs" aria-label="选择版块">
            <SelectValue placeholder="全部版块" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部版块</SelectItem>
            {boardTree.map((root) => (
              <SelectItem key={root.slug} value={root.slug}>
                {root.name}（{root.total_topics} 帖）
              </SelectItem>
            ))}
            {boardTree.flatMap((root) =>
              collectBoards(root.children).map((child) => (
                <SelectItem key={child.slug} value={child.slug}>
                  {child.path}（{child.total_topics}）
                </SelectItem>
              )),
            )}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">
          {activeBoard ? `${activeBoard.total_topics} 帖` : '学术与站务'}
        </span>

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
        <ErrorState message="加载讨论失败" onRetry={() => listQ.refetch()} />
      ) : topics.length === 0 ? (
        <EmptyState
          title="还没有人发帖"
          description="第一个帖子可以是你：问一个问题，或提一条建议。"
          action={
            <Button
              size="sm"
              onClick={openComposer}
            >
              发第一个帖
            </Button>
          }
        />
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          {topics.map((t) => (
            <div
              key={t.id}
              className={cn(
                'flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/20',
                // 编辑部公告用左侧主色条突出：公告不是普通帖子
                t.category === 'notice' && 'border-l-4 border-l-primary',
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
                    {t.category === 'notice' ? (
                      <Badge className="gap-1 border border-transparent bg-primary text-primary-foreground">
                        <Megaphone className="h-3 w-3" />
                        编辑部公告
                      </Badge>
                    ) : (
                      <Badge variant="outline" className={CATEGORY_STYLE[t.category]}>
                        {t.board_name ?? CATEGORY_LABEL[t.category] ?? t.category}
                      </Badge>
                    )}
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
                <div className="flex shrink-0 items-center gap-1 rounded-full bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="tabular-nums">{t.reply_count}</span>
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
          className="top-0 left-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(92vh,880px)] sm:max-h-[min(92vh,880px)] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:border"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            titleRef.current?.focus()
          }}
        >
          <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">NEW TOPIC</p>
              <DialogTitle className="mt-1 font-serif text-xl tracking-tight">发新帖</DialogTitle>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="关闭发帖">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-3xl space-y-4">
              <input
                ref={titleRef}
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                maxLength={200}
                placeholder="标题：一句话说清你要讨论什么"
                aria-label="帖子标题"
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
                    <SelectTrigger className="h-8 w-[280px] text-xs" aria-label="选择版块">
                      <SelectValue placeholder="选择最具体的子板块" />
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
                    <span className="text-muted-foreground">发到：</span>
                    <span className="font-medium">{selectedBoard?.name ?? '选择版块'}</span>
                    <span className="text-primary">修改</span>
                  </button>
                )}
                <span className="text-[11px] text-muted-foreground">父板块会自动汇总子板块帖子；发帖登录即可，不需要积分。</span>
              </div>

              <Suspense fallback={<div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">编辑器加载中…</div>}>
                <MarkdownEditor
                  value={form.body}
                  onChange={(body) => setForm((p) => ({ ...p, body }))}
                  onUploadImage={uploadForumImage}
                  minHeight={360}
                  compact
                  textareaRef={bodyRef}
                  onSubmitShortcut={publishTopic}
                  placeholder="说清背景、你的判断、以及希望得到什么回应。支持 Markdown、表情和图片。"
                />
              </Suspense>
            </div>
          </div>

          <div className="border-t px-4 py-3 sm:px-6">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">
                草稿自动保存在本机 · Ctrl / ⌘ + Enter 发布 · 正文 {form.body.length} 字
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button
                  onClick={publishTopic}
                  disabled={createMut.isPending || !form.board_id || form.title.trim().length < 2 || form.body.trim().length < 2}
                >
                  {createMut.isPending ? '发布中…' : '发布'}
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
