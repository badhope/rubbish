import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellOff, Bookmark, MessagesSquare, Trash2, UserMinus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import {
  useDisciplines,
  useMyFollowedAuthors,
  useMySubscribedDisciplines,
  useUnfollowAuthor,
  useUnsubscribeDiscipline,
} from '@/hooks/api/use-modules'
import { extractError } from '@/lib/utils'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Tab = 'authors' | 'disciplines' | 'topics'

interface FollowedTopic {
  id: number
  title: string
  body?: string
  board_name?: string | null
  reply_count: number
  last_reply_at?: string | null
  created_at?: string
  author?: { username?: string; display_name?: string | null } | null
}

interface FollowedTopicList {
  data: FollowedTopic[]
  meta: { page: number; total: number; total_pages: number }
}

export function MeFollows() {
  const [tab, setTab] = useState<Tab>('authors')
  return (
    <div>
      <div className="border-b pb-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">FOLLOWING</p>
        <h2 className="mt-1 font-serif text-xl tracking-tight">关注与订阅</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          作者、方向和正在追的主题帖，集中在一页管理。
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="authors" className="shrink-0">我关注的作者</TabsTrigger>
          <TabsTrigger value="disciplines" className="shrink-0">我订阅的方向</TabsTrigger>
          <TabsTrigger value="topics" className="shrink-0">我追的帖子</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'authors' ? (
        <AuthorsTab />
      ) : tab === 'disciplines' ? (
        <DisciplinesTab />
      ) : (
        <TopicsTab />
      )}
    </div>
  )
}

const PAGE_SIZE = 20

function AuthorsTab() {
  const [page, setPage] = useState(1)
  const { data, isLoading, isError, refetch } = useMyFollowedAuthors(page, PAGE_SIZE)
  const unfollowMut = useUnfollowAuthor()

  const onUnfollow = async (authorName: string) => {
    try {
      await unfollowMut.mutateAsync(authorName)
      toast.success(`已取消关注 ${authorName}`)
    } catch (err) {
      toast.error(extractError(err, '没能取消关注，可再试一次'))
    }
  }

  if (isLoading) return <Loading />
  if (isError) {
    return <ErrorState message="关注作者列表加载失败，可重试。" onRetry={() => refetch()} />
  }
  if (!data || data.data.length === 0) {
    return (
      <EmptyState
        title="暂未关注任何作者"
        description="在资源详情页可以关注作者，关注后会出现在这里。"
      />
    )
  }
  return (
    <div className="space-y-4">
      {data.data.map((entry) => (
        <Card key={entry.author_name}>
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{entry.author_name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                关注于 {new Date(entry.followed_at).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onUnfollow(entry.author_name)}
              disabled={unfollowMut.isPending}
            >
              <UserMinus className="h-4 w-4" />
              取消关注
            </Button>
          </CardContent>
        </Card>
      ))}
      <Pagination
        page={data.meta.page}
        totalPages={data.meta.total_pages}
        onPageChange={setPage}
      />
    </div>
  )
}

function DisciplinesTab() {
  const { data, isLoading, isError, refetch } = useMySubscribedDisciplines()
  const disciplines = useDisciplines()
  const unsubscribeMut = useUnsubscribeDiscipline()
  const nameToSlug = new Map(
    (disciplines.data ?? []).map((item) => [item.name, item.slug]),
  )

  const onUnsubscribe = async (discipline: string) => {
    try {
      await unsubscribeMut.mutateAsync(discipline)
      toast.success(`已取消订阅 ${discipline}`)
    } catch (err) {
      toast.error(extractError(err, '没能取消订阅，可再试一次'))
    }
  }

  if (isLoading) return <Loading />
  if (isError) {
    return <ErrorState message="订阅话题加载失败，可重试。" onRetry={() => refetch()} />
  }
  if (!data || data.data.length === 0) {
    return (
      <EmptyState
        title="暂未订阅任何话题"
        description="在作品页或领域页可以订阅方向，订阅后会出现在这里。"
      />
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {data.data.map((discipline) => {
        const slug = nameToSlug.get(discipline)
        return (
          <span
            key={discipline}
            className="flex items-center gap-1.5 rounded-full border bg-secondary px-3 py-1.5 text-sm"
          >
            <Bookmark className="h-3.5 w-3.5 shrink-0" />
            {slug ? (
              <Link
                to="/fields/$slug"
                params={{ slug }}
                className="hover:text-primary hover:underline"
              >
                {discipline}
              </Link>
            ) : (
              <span>{discipline}</span>
            )}
            <button
              type="button"
              onClick={() => onUnsubscribe(discipline)}
              disabled={unsubscribeMut.isPending}
              className="ml-1 rounded-full text-muted-foreground hover:text-foreground"
              aria-label={`取消订阅 ${discipline}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )
      })}
    </div>
  )
}

function TopicsTab() {
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const query = useQuery<FollowedTopicList>({
    queryKey: ['forum', 'my-followed-topics', page] as const,
    queryFn: async () =>
      (
        await api.get<FollowedTopicList>('/forum/topics', {
          params: { sort: 'following', page, page_size: PAGE_SIZE },
        })
      ).data,
    placeholderData: (prev) => prev,
  })
  const unfollow = useMutation({
    mutationFn: async (topicId: number) => api.delete(`/forum/topics/${topicId}/follow`),
    onSuccess: () => {
      toast.success('已取消追更')
      void queryClient.invalidateQueries({ queryKey: ['forum', 'my-followed-topics'] })
      void queryClient.invalidateQueries({ queryKey: ['forum', 'topics'] })
    },
    onError: (err) => toast.error(extractError(err, '没能取消追更，可再试一次')),
  })

  if (query.isLoading) return <Loading />
  if (query.isError) {
    return <ErrorState message="追更列表加载失败，可重试。" onRetry={() => void query.refetch()} />
  }
  if (!query.data || query.data.data.length === 0) {
    return (
      <EmptyState
        title="还没有关注任何帖子"
        description="在主题帖里点「关注回应」，有新回复时这里会留着；帖子作者本人不需要关注自己的帖子。"
      />
    )
  }

  return (
    <div className="space-y-4">
      {query.data.data.map((topic) => (
        <Card key={topic.id}>
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <MessagesSquare className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <Link
                  to="/forum/$topicId"
                  params={{ topicId: String(topic.id) }}
                  className="line-clamp-2 text-sm font-medium hover:text-primary"
                >
                  {topic.title}
                </Link>
                {topic.body ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{topic.body}</p>
                ) : null}
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  <span>{topic.author?.display_name || topic.author?.username || '已注销用户'}</span>
                  <span>· {topic.reply_count} 条回应</span>
                  {topic.board_name ? <span>· {topic.board_name}</span> : null}
                  {topic.last_reply_at ? (
                    <span>· 最近回应 {new Date(topic.last_reply_at).toLocaleDateString()}</span>
                  ) : null}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => unfollow.mutate(topic.id)}
                disabled={unfollow.isPending}
              >
                <BellOff className="h-4 w-4" />
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <Pagination
        page={query.data.meta.page}
        totalPages={query.data.meta.total_pages}
        onPageChange={setPage}
      />
    </div>
  )
}
