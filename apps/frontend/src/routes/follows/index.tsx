import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Bookmark, Trash2, UserMinus } from 'lucide-react'
import { toast } from 'sonner'
import { getAuthState } from '@/lib/auth'
import {
  useMyFollowedAuthors,
  useMySubscribedDisciplines,
  useUnfollowAuthor,
  useUnsubscribeDiscipline,
} from '@/hooks/api/use-modules'
import { extractError } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/follows/')({
  beforeLoad: () => {
    if (!getAuthState().isAuthenticated) throw redirect({ to: '/login' })
  },
  component: FollowsPage,
})

type Tab = 'authors' | 'disciplines'

function FollowsPage() {
  const [tab, setTab] = useState<Tab>('authors')
  return (
    <div>
      <PageHeader
        title="关注与订阅"
        description="管理你关注的作者和订阅的学科。"
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
      >
        <TabsList>
          <TabsTrigger value="authors">我关注的作者</TabsTrigger>
          <TabsTrigger value="disciplines">我订阅的学科</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'authors' ? <AuthorsTab /> : <DisciplinesTab />}
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
      toast.error(extractError(err, '操作失败'))
    }
  }

  if (isLoading) return <Loading />
  if (isError) {
    return <ErrorState message="加载失败" onRetry={() => refetch()} />
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
  const unsubscribeMut = useUnsubscribeDiscipline()

  const onUnsubscribe = async (discipline: string) => {
    try {
      await unsubscribeMut.mutateAsync(discipline)
      toast.success(`已取消订阅 ${discipline}`)
    } catch (err) {
      toast.error(extractError(err, '操作失败'))
    }
  }

  if (isLoading) return <Loading />
  if (isError) {
    return <ErrorState message="加载失败" onRetry={() => refetch()} />
  }
  if (!data || data.data.length === 0) {
    return (
      <EmptyState
        title="暂未订阅任何学科"
        description="在资源详情页可以订阅学科，订阅后会出现在这里。"
      />
    )
  }
  return (
    <div className="flex flex-wrap gap-2">
      {data.data.map((slug) => (
        <Badge
          key={slug}
          variant="secondary"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm"
        >
          <Bookmark className="h-3.5 w-3.5" />
          {slug}
          <button
            type="button"
            onClick={() => onUnsubscribe(slug)}
            disabled={unsubscribeMut.isPending}
            className="ml-1 rounded-full text-muted-foreground hover:text-foreground"
            aria-label={`取消订阅 ${slug}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Badge>
      ))}
    </div>
  )
}
