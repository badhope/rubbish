import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Bookmark,
  Flag,
  HeartHandshake,
  Bell,
  BellOff,
  Lock,
  MessageSquare,
  Pencil,
  Pin,
  Reply,
  Send,
  Share2,
  ThumbsUp,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { uploadForumImage } from '@/lib/forum'
import { extractError } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { MarkdownContent } from '@/components/common/markdown-content'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const ForumEditor = lazy(() =>
  import('@/components/forum/forum-editor').then((m) => ({ default: m.ForumEditor })),
)

export const Route = createFileRoute('/forum/$topicId')({
  component: ForumTopicPage,
})

type ReactionKind = 'agree' | 'helpful' | 'bookmark'

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
  author: { id: number; username: string; display_name?: string | null; avatar_url?: string | null } | null
  reactions?: Record<string, number>
  viewer_reactions?: string[]
}

interface BoardNode {
  id: number
  name: string
  children: BoardNode[]
}

interface ForumReply {
  id: number
  topic_id: number
  parent_id: number | null
  body: string
  created_at: string
  author: { id: number; username: string; display_name?: string | null; avatar_url?: string | null } | null
  reactions?: Record<string, number>
  viewer_reactions?: string[]
}

const CATEGORY_LABEL: Record<string, string> = {
  discussion: '写作讨论',
  records: '记录与复盘',
  collab: '组队招募',
  life: '创作生活',
  site: '站务与反馈',
  // 旧帖子兜底
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

const REACTIONS: {
  kind: ReactionKind
  label: string
  icon: typeof ThumbsUp
}[] = [
  { kind: 'agree', label: '赞同', icon: ThumbsUp },
  { kind: 'helpful', label: '有帮助', icon: HeartHandshake },
  { kind: 'bookmark', label: '收藏', icon: Bookmark },
]

const REPORT_REASONS = ['垃圾广告', '不友善内容', '违法违规', '其他']

function flattenBoards(nodes: BoardNode[], depth = 0): Array<BoardNode & { depth: number }> {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flattenBoards(node.children ?? [], depth + 1),
  ])
}

function ReactionBar({
  targetType,
  targetId,
  reactions,
  viewer,
}: {
  targetType: 'topic' | 'reply'
  targetId: number
  reactions?: Record<string, number>
  viewer?: string[]
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const mut = useMutation({
    mutationFn: async (kind: ReactionKind) =>
      (await api.post('/forum/reactions/toggle', { target_type: targetType, target_id: targetId, kind }))
        .data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['forum'] })
    },
    onError: (err) => toast.error(extractError(err, '操作失败')),
  })

  return (
    <div className="flex flex-wrap items-center gap-1">
      {REACTIONS.map(({ kind, label, icon: Icon }) => {
        const active = viewer?.includes(kind) ?? false
        const count = reactions?.[kind] ?? 0
        return (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant={active ? 'secondary' : 'ghost'}
            aria-pressed={active}
            disabled={mut.isPending}
            onClick={() => {
              if (!isAuthenticated) {
                void navigate({ to: '/login', search: { redirect: window.location.pathname } })
                return
              }
              mut.mutate(kind)
            }}
            className={cn(
              'h-7 gap-1 rounded-full px-2 text-[11px]',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {count > 0 && <span className="tabular-nums">{count}</span>}
          </Button>
        )
      })}
    </div>
  )
}

function ReplyCard({
  reply,
  isRoot,
  parentAuthor,
  topicAuthorId,
  canReply,
  onReply,
  onReport,
  inlineReply,
}: {
  reply: ForumReply
  isRoot: boolean
  parentAuthor?: string
  topicAuthorId?: number
  canReply: boolean
  onReply: (reply: ForumReply) => void
  onReport: (target: { reply_id: number; reason: string }) => void
  inlineReply?: ReactNode
}) {
  const { isAuthenticated, user } = useAuth()
  const isTopicAuthor = reply.author?.id !== undefined && reply.author.id === topicAuthorId
  const own = reply.author?.id === user?.id

  return (
    <Card
      id={`reply-${reply.id}`}
      className={cn(
        'scroll-mt-24',
        isRoot ? '' : 'ml-4 border-l-2 border-l-primary/20 sm:ml-8',
      )}
    >
      <CardContent className="space-y-2 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {!isRoot && parentAuthor && (
              <p className="mb-0.5 text-[11px] text-muted-foreground">
                回复 @{parentAuthor}
              </p>
            )}
            <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              {reply.author?.avatar_url ? (
                <img src={reply.author.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
              ) : null}
              <span className="font-medium text-foreground">
                {reply.author?.display_name || reply.author?.username || '已注销用户'}
              </span>
              {isTopicAuthor && (
                <Badge variant="outline" className="h-4 px-1 text-[10px]">
                  楼主
                </Badge>
              )}
              <span>·</span>
              <span>{new Date(reply.created_at).toLocaleString('zh-CN')}</span>
            </p>
          </div>
          {isAuthenticated && !own && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground"
                  aria-label="举报回复"
                >
                  <Flag className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {REPORT_REASONS.map((reason) => (
                  <DropdownMenuItem
                    key={reason}
                    onClick={() => onReport({ reply_id: reply.id, reason })}
                  >
                    {reason}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <MarkdownContent text={reply.body} className="text-sm leading-relaxed" />

        <div className="flex items-center gap-1 border-t pt-1.5">
          <ReactionBar
            targetType="reply"
            targetId={reply.id}
            reactions={reply.reactions}
            viewer={reply.viewer_reactions}
          />
          {canReply && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onReply(reply)}
              className="ml-auto h-7 gap-1 rounded-full px-2 text-[11px] text-muted-foreground"
            >
              <Reply className="h-3.5 w-3.5" />
              回复
            </Button>
          )}
        </div>
        {inlineReply}
      </CardContent>
    </Card>
  )
}

function ForumTopicPage() {
  const { topicId } = Route.useParams()
  const id = Number(topicId)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { isAuthenticated, user, isAdmin } = useAuth()
  const [reply, setReply] = useState('')
  const [replyTo, setReplyTo] = useState<ForumReply | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)

  const topicQ = useQuery<ForumTopic>({
    queryKey: ['forum', 'topic', id],
    queryFn: async () => (await api.get<ForumTopic>(`/forum/topics/${id}`)).data,
    enabled: id > 0,
  })

  const repliesQ = useQuery<ForumReply[]>({
    queryKey: ['forum', 'replies', id],
    queryFn: async () => (await api.get<ForumReply[]>(`/forum/topics/${id}/replies`)).data,
    enabled: id > 0,
  })

  const replyMut = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/forum/topics/${id}/replies`, {
          body: reply,
          parent_id: replyTo ? (replyTo.parent_id ?? replyTo.id) : null,
        })
      ).data,
    onSuccess: () => {
      setReply('')
      setReplyTo(null)
      setComposerOpen(false)
      void qc.invalidateQueries({ queryKey: ['forum'] })
      toast.success(replyTo ? '已回复' : '已发布回复')
    },
    onError: (err) => toast.error(extractError(err, '回复失败')),
  })

  const sendReply = () => {
    if (replyMut.isPending || reply.trim().length < 1) return
    replyMut.mutate()
  }

  const deleteMut = useMutation({
    mutationFn: async () => (await api.delete(`/forum/topics/${id}`)).data,
    onSuccess: () => {
      toast.success('已删除')
      void qc.invalidateQueries({ queryKey: ['forum'] })
      void navigate({ to: '/forum' })
    },
    onError: (err) => toast.error(extractError(err, '删除失败')),
  })

  const followQ = useQuery<{ following: boolean; followers_count: number }>({
    queryKey: ['forum', 'topic', id, 'follow'],
    queryFn: async () => (await api.get(`/forum/topics/${id}/follow`)).data,
    enabled: id > 0 && isAuthenticated,
  })

  const followMut = useMutation({
    mutationFn: async (next: boolean) =>
      (
        await (next
          ? api.post(`/forum/topics/${id}/follow`)
          : api.delete(`/forum/topics/${id}/follow`))
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['forum', 'topic', id, 'follow'] })
      toast.success(followQ.data?.following ? '已取消关注' : '已关注，有新回复会通知你')
    },
    onError: (err) => toast.error(extractError(err, '操作失败')),
  })

  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editFictional, setEditFictional] = useState(false)
  const [editBoardId, setEditBoardId] = useState<number | null>(null)
  const boardsQ = useQuery({
    queryKey: ['forum', 'boards'],
    queryFn: async () => (await api.get('/forum/boards')).data,
    enabled: editOpen,
  })
  const editBoards = useMemo(
    () => flattenBoards((boardsQ.data?.tree ?? []) as BoardNode[]),
    [boardsQ.data],
  )

  const openEdit = () => {
    if (!topicQ.data) return
    setEditTitle(topicQ.data.title)
    setEditBody(topicQ.data.body)
    setEditFictional(topicQ.data.is_fictional)
    setEditBoardId(topicQ.data.board_id)
    setEditOpen(true)
  }

  const editMut = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/forum/topics/${id}/edit`, {
          title: editTitle.trim(),
          body: editBody.trim(),
          board_id: editBoardId,
          is_fictional: editFictional,
        })
      ).data,
    onSuccess: () => {
      setEditOpen(false)
      void qc.invalidateQueries({ queryKey: ['forum'] })
      toast.success('帖子已更新')
    },
    onError: (err) => toast.error(extractError(err, '保存失败')),
  })

  const reportMut = useMutation({
    mutationFn: async (target: { topic_id?: number; reply_id?: number; reason?: string }) =>
      (await api.post('/forum/reports', target)).data,
    onSuccess: () => toast.success('已举报，站务会尽快处理'),
    onError: (err) => toast.error(extractError(err, '举报失败')),
  })

  const threads = useMemo(() => {
    const roots = (repliesQ.data ?? []).filter((r) => !r.parent_id)
    const children = new Map<number, ForumReply[]>()
    for (const r of repliesQ.data ?? []) {
      if (!r.parent_id) continue
      const list = children.get(r.parent_id) ?? []
      list.push(r)
      children.set(r.parent_id, list)
    }
    return roots.map((root) => ({ root, children: children.get(root.id) ?? [] }))
  }, [repliesQ.data])

  const parentName = (replyItem: ForumReply) =>
    repliesQ.data?.find((r) => r.id === replyItem.parent_id)?.author?.username

  const startReply = (target: ForumReply) => {
    if (replyTo?.id !== target.id) setReply('')
    setReplyTo(target)
  }

  const cancelReply = () => {
    setReply('')
    setReplyTo(null)
  }

  const renderInlineReply = (target: ForumReply) => {
    if (replyTo?.id !== target.id) return null
    return (
      <div className="mt-2 rounded-lg border bg-muted/25 p-2.5">
        <div className="mb-2 text-[11px] text-muted-foreground">
          回复 @{target.author?.display_name || target.author?.username || '已注销用户'}
        </div>
        <Suspense fallback={<div className="flex h-[120px] items-center justify-center rounded-md border bg-muted/20 text-xs text-muted-foreground">编辑器加载中…</div>}>
          <ForumEditor
            value={reply}
            onChange={setReply}
            onUploadImage={uploadForumImage}
            minHeight={120}
            autoFocus
            onSubmitShortcut={sendReply}
            placeholder="写在这条回复下面；Ctrl / ⌘ + Enter 发送"
          />
        </Suspense>
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={cancelReply}>
            取消
          </Button>
          <Button size="sm" onClick={sendReply} disabled={replyMut.isPending || reply.trim().length < 1}>
            <Send className="h-4 w-4" />
            {replyMut.isPending ? '发送中…' : '回复'}
          </Button>
        </div>
      </div>
    )
  }

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('链接已复制，可以发给同好或朋友')
    } catch {
      toast.error('复制失败，请手动复制地址栏')
    }
  }

  if (topicQ.isLoading) return <Loading />
  if (topicQ.isError || !topicQ.data) {
    return <ErrorState message="帖子不存在或已被删除" onRetry={() => topicQ.refetch()} />
  }
  const topic = topicQ.data
  const canDelete = isAuthenticated && (isAdmin || topic.author?.id === user?.id)
  const canEdit = isAuthenticated && topic.author?.id === user?.id && !topic.is_locked
  const following = followQ.data?.following ?? false
  const followersCount = followQ.data?.followers_count ?? 0

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        to="/forum"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        返回讨论区
      </Link>

      <Card>
        <CardContent className="space-y-3 py-5">
          <div className="flex flex-wrap items-center gap-2">
            {topic.is_pinned && (
              <Badge className="gap-1 bg-primary/15 text-primary">
                <Pin className="h-3 w-3" />
                置顶
              </Badge>
            )}
            <Badge variant="outline">{topic.board_name ?? CATEGORY_LABEL[topic.category] ?? topic.category}</Badge>
            {topic.is_fictional ? (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                虚构
              </Badge>
            ) : null}
            {topic.board_path && topic.board_path !== topic.board_name ? (
              <span className="text-[11px] text-muted-foreground">{topic.board_path}</span>
            ) : null}
            {topic.is_locked && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="h-3 w-3" />
                已锁定
              </Badge>
            )}
          </div>
          <h1 className="text-xl font-semibold leading-snug">{topic.title}</h1>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {topic.author?.avatar_url ? (
              <img src={topic.author.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
            ) : null}
            {topic.author?.display_name || topic.author?.username || '已注销用户'} ·{' '}
            {new Date(topic.created_at).toLocaleString('zh-CN')}
          </p>
          {/* 主楼按 Markdown 渲染；react-markdown 默认转义原始 HTML，XSS 面为零。 */}
          <div className="markdown-body text-sm leading-relaxed">
            <MarkdownContent text={topic.body} />
          </div>

          <div className="flex flex-wrap items-center gap-1 border-t pt-2">
            <ReactionBar
              targetType="topic"
              targetId={topic.id}
              reactions={topic.reactions}
              viewer={topic.viewer_reactions}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void share()}
              className="h-7 gap-1 rounded-full px-2 text-[11px] text-muted-foreground"
            >
              <Share2 className="h-3.5 w-3.5" />
              分享
            </Button>
            {isAuthenticated && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => followMut.mutate(!following)}
                disabled={followMut.isPending}
                className="h-7 gap-1 rounded-full px-2 text-[11px] text-muted-foreground"
              >
                {following ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                {following ? '已关注' : '关注'} {followersCount > 0 ? followersCount : ''}
              </Button>
            )}
            {canEdit || canDelete ? (
              <div className="ml-auto flex items-center gap-1">
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                    onClick={openEdit}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    编辑
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-[11px] text-destructive"
                    onClick={() => {
                      if (window.confirm('确定删除这个帖子？')) deleteMut.mutate()
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                )}
              </div>
            ) : null}
            {isAuthenticated && !canDelete && !canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                  >
                    <Flag className="h-3.5 w-3.5" />
                    举报
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {REPORT_REASONS.map((reason) => (
                    <DropdownMenuItem
                      key={reason}
                      onClick={() => reportMut.mutate({ topic_id: id, reason })}
                    >
                      {reason}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
          回复（{topic.reply_count}）
        </p>
        {repliesQ.isLoading ? (
          <Loading />
        ) : !repliesQ.data?.length ? (
          <EmptyState title="还没有回复" description="你可以是第一个回应的人。" />
        ) : (
          <div className="space-y-3">
            {threads.map(({ root, children }) => (
              <div key={root.id} className="space-y-2">
                <ReplyCard
                  reply={root}
                  isRoot
                  parentAuthor={parentName(root)}
                  topicAuthorId={topic.author?.id}
                  canReply={isAuthenticated && !topic.is_locked}
                  onReply={startReply}
                  onReport={(target) => reportMut.mutate(target)}
                  inlineReply={renderInlineReply(root)}
                />
                {children.length > 0 && (
                  <div className="space-y-2">
                    {children.map((child) => (
                      <ReplyCard
                        key={child.id}
                        reply={child}
                        isRoot={false}
                        parentAuthor={parentName(child)}
                        topicAuthorId={topic.author?.id}
                        canReply={isAuthenticated && !topic.is_locked}
                        onReply={startReply}
                        onReport={(target) => reportMut.mutate(target)}
                        inlineReply={renderInlineReply(child)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {topic.is_locked ? (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          该帖已锁定，不再接受新回复。
        </p>
      ) : replyTo ? null : (
        <Card>
          <CardContent className="space-y-2 py-4">
            {isAuthenticated ? (
              composerOpen ? (
                <>
                  <Suspense fallback={<div className="flex h-[160px] items-center justify-center rounded-md border bg-muted/20 text-xs text-muted-foreground">编辑器加载中…</div>}>
                    <ForumEditor
                      value={reply}
                      onChange={setReply}
                      onUploadImage={uploadForumImage}
                      minHeight={160}
                      autoFocus
                      onSubmitShortcut={sendReply}
                      placeholder="写下你的回应…（支持标题、引用、列表、表情和站内表情包）"
                    />
                  </Suspense>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      Ctrl / ⌘ + Enter 发送；请针对内容，不针对人。
                    </span>
                    <Button
                      onClick={sendReply}
                      disabled={replyMut.isPending || reply.trim().length < 1}
                    >
                      <Send className="h-4 w-4" />
                      {replyMut.isPending ? '发送中…' : '发布回复'}
                    </Button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setComposerOpen(true)}
                  className="flex w-full items-center gap-2 rounded-md border border-dashed bg-muted/20 px-3 py-4 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/30 hover:text-foreground"
                >
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  <span>写下你的回应…</span>
                  <span className="ml-auto text-[11px]">Markdown / 图片 / 表情</span>
                </button>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                <Link to="/login" className="text-primary hover:underline">
                  登录
                </Link>{' '}
                后可以回复。
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent
          showCloseButton={false}
          className="forum-writing-desk top-0 left-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(90vh,900px)] sm:max-h-[min(90vh,900px)] sm:max-w-[1100px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border"
        >
          <div className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
            <DialogTitle className="font-serif text-xl tracking-tight">编辑帖子</DialogTitle>
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>
              关闭
            </Button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
            <Input
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              maxLength={200}
              placeholder="标题"
              aria-label="帖子标题"
              className="border-0 bg-transparent px-0 font-serif text-2xl shadow-none focus-visible:ring-0"
            />
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={editBoardId ?? ''}
                onChange={(event) => setEditBoardId(event.target.value ? Number(event.target.value) : null)}
                aria-label="帖子分区"
                className="rounded-full border bg-card px-3 py-1 text-xs text-foreground outline-none focus:border-primary"
              >
                <option value="" disabled>
                  选择分区
                </option>
                {editBoards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {`${'　'.repeat(board.depth)}${board.name}`}
                  </option>
                ))}
              </select>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={editFictional}
                onChange={(event) => setEditFictional(event.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              这是虚构内容
            </label>
            </div>
            <Suspense
              fallback={
                <div className="rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
                  编辑器加载中…
                </div>
              }
            >
              <ForumEditor
                value={editBody}
                onChange={setEditBody}
                onUploadImage={uploadForumImage}
                minHeight={520}
                placeholder="修改正文…"
              />
            </Suspense>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-3 sm:px-6">
            <span className="text-[11px] text-muted-foreground">
              正文 {editBody.length} 字 · 保存后立即对外可见
            </span>
            <Button
              onClick={() => editMut.mutate()}
              disabled={editMut.isPending || editTitle.trim().length < 2 || editBody.trim().length < 2}
            >
              {editMut.isPending ? '保存中…' : '保存修改'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
