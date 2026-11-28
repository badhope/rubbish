import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowRight,
  BookOpen,
  Check,
  Loader2,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { useUnifiedSearch } from '@/hooks/api/use-search'
import {
  useDisciplineSubscriptionStatus,
  useDisciplines,
  usePublicExpertise,
  useResources,
  useSubscribeDiscipline,
  useUnsubscribeDiscipline,
} from '@/hooks/api/use-modules'
import { ArticleCover } from '@/components/common/article-cover'
import { Pagination } from '@/components/common/pagination'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { SearchPersonCard } from '@/hooks/api/use-search'
import type { ResourceResponse } from '@/lib/types'

export const Route = createFileRoute('/fields/$slug')({
  component: FieldPage,
})

function formatPeopleCount(value: number | undefined): string {
  return value === undefined ? '—' : String(value)
}

function MemberCard({ row }: { row: SearchPersonCard }) {
  return (
    <Link
      to="/u/$username"
      params={{ username: row.username }}
      className="group flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
    >
      {row.avatar_url ? (
        <img src={row.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-serif text-base text-primary">
          {(row.display_name || row.username).slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium group-hover:text-primary">
          {row.display_name || row.username}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">@{row.username}</span>
        {row.bio || row.affiliation ? (
          <span className="mt-1.5 line-clamp-2 block text-xs leading-5 text-muted-foreground">
            {row.bio || row.affiliation}
          </span>
        ) : null}
        <span className="mt-2 block text-[11px] text-muted-foreground">
          {row.works} 篇作品 · {row.followers} 关注者
        </span>
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary" />
    </Link>
  )
}

function WorkRow({ row }: { row: ResourceResponse }) {
  return (
    <Link
      to="/catalog/$resourceId"
      params={{ resourceId: String(row.id) }}
      className="group flex gap-3 py-3 first:pt-0 last:pb-0"
    >
      <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
        <ArticleCover resource={row} showDiscipline={false} aspect="aspect-[4/3]" />
      </div>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-sm font-medium leading-6 group-hover:text-primary">
          {row.short_title?.trim() || row.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
          <span>{row.authors.slice(0, 2).join('、') || '未署名'}</span>
          <span aria-hidden>·</span>
          <span>{row.year}</span>
          {row.reads ? (
            <>
              <span aria-hidden>·</span>
              <span>{row.reads} 阅读</span>
            </>
          ) : null}
        </span>
      </span>
    </Link>
  )
}

function FieldPage() {
  const { slug } = Route.useParams()
  const { isAuthenticated } = useAuth()
  const [memberPage, setMemberPage] = useState(1)
  const [workPage, setWorkPage] = useState(1)
  const disciplines = useDisciplines()
  const area = (disciplines.data ?? []).find((item) => item.slug === slug)

  useEffect(() => {
    setMemberPage(1)
    setWorkPage(1)
  }, [slug])

  const people = useUnifiedSearch('people', undefined, memberPage, slug, 8)
  const resourcesQ = useResources(
    { discipline: area?.name, page: workPage, page_size: 6 },
    Boolean(area?.name) && isAuthenticated,
  )
  const expertise = usePublicExpertise()
  const subscription = useDisciplineSubscriptionStatus(area?.name ?? '')
  const subscribe = useSubscribeDiscipline()
  const unsubscribe = useUnsubscribeDiscipline()

  if (disciplines.isLoading) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在读领域词表…
      </div>
    )
  }
  if (disciplines.isError) {
    return <ErrorState message="领域词表没加载出来" onRetry={() => void disciplines.refetch()} />
  }
  if (!area) {
    return (
      <div className="mx-auto w-full max-w-xl py-12">
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <h1 className="font-serif text-xl font-semibold">这个词表里没有这个领域</h1>
            <p className="text-sm text-muted-foreground">
              链接可能是旧的，或者这个 slug 还没进受控词表。回发现页按现有方向找。
            </p>
            <Button asChild size="sm" variant="outline">
              <Link to="/explore">回发现页</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const members = people.data?.people ?? []
  const memberTotal = people.data?.meta.totals.people
  const memberPages = Math.max(1, Math.ceil((memberTotal ?? 0) / 8))
  const works = resourcesQ.data?.data ?? []
  const workTotal = resourcesQ.data?.meta.total
  const workPages = Math.max(1, resourcesQ.data?.meta.total_pages ?? 0)
  const reviewerCount = expertise.data
    ? (expertise.data.disciplines.find((item) => item.slug === slug)?.reviewer_count ?? 0)
    : undefined
  const subscriberCount = subscription.data?.subscribers_count
  const subscribed = Boolean(subscription.data?.subscribed)

  const toggleSubscribe = async () => {
    try {
      if (subscribed) await unsubscribe.mutateAsync(area.name)
      else await subscribe.mutateAsync(area.name)
      toast.success(subscribed ? '已取消订阅这个方向' : '已订阅，有新作品会通知你')
    } catch {
      toast.error('订阅没成功，可再试一次')
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title={area.name}
        description={
          area.description?.trim() ||
          '按受控词表进入的领域页：看同方向的人、最近公开的作品，以及互评成员覆盖。'
        }
        actions={
          isAuthenticated ? (
            <Button
              size="sm"
              variant={subscribed ? 'outline' : 'default'}
              onClick={() => void toggleSubscribe()}
              disabled={subscribe.isPending || unsubscribe.isPending || subscription.isLoading}
            >
              {subscribed ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {subscribed ? '已订阅' : '订阅这个方向'}
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link
                to="/login"
                search={{ redirect: `/fields/${slug}` }}
              >
                登录后订阅
              </Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <Badge variant="secondary" className="font-normal">
          {`${formatPeopleCount(memberTotal)} 位同领域成员`}
        </Badge>
        <Badge variant="outline" className="font-normal">
          {`${workTotal ?? '—'} 篇公开作品`}
        </Badge>
        <Badge variant="outline" className="font-normal">
          {`${reviewerCount ?? '—'} 位互评成员覆盖`}
        </Badge>
        <span>{`订阅 ${subscriberCount ?? '—'} 人`}</span>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <BookOpen className="h-4 w-4 text-primary" />
                  最近作品
                </h2>
                <Link
                  to="/catalog"
                  search={{ discipline: area.name }}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                >
                  看全部 <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              {!isAuthenticated ? (
                <p className="py-6 text-sm text-muted-foreground">
                  登录后可读这个方向的公开作品。{' '}
                  <Link
                    to="/login"
                    search={{ redirect: `/fields/${slug}` }}
                    className="text-primary hover:underline"
                  >
                    去登录
                  </Link>
                </p>
              ) : resourcesQ.isLoading ? (
                <div className="py-8 text-sm text-muted-foreground">正在读作品…</div>
              ) : resourcesQ.isError ? (
                <p className="py-8 text-sm text-muted-foreground">
                  作品没加载出来。{' '}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => void resourcesQ.refetch()}
                  >
                    再试一次
                  </button>
                </p>
              ) : works.length > 0 ? (
                <div className="mt-3 divide-y">
                  {works.map((row) => (
                    <WorkRow key={row.id} row={row} />
                  ))}
                </div>
              ) : (
                <p className="py-6 text-sm text-muted-foreground">
                  这个方向还没有公开作品。等第一篇落地，这里会自动出现。
                </p>
              )}
              <Pagination page={workPage} totalPages={workPages} onPageChange={setWorkPage} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4 text-primary" />
                  同领域成员
                </h2>
                <Link
                  to="/search"
                  search={{ type: 'people', discipline: slug }}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                >
                  看全部 <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              {people.isLoading ? (
                <div className="py-8 text-sm text-muted-foreground">正在找人…</div>
              ) : people.isError ? (
                <p className="py-8 text-sm text-muted-foreground">
                  同领域成员没加载出来。{' '}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => void people.refetch()}
                  >
                    再试一次
                  </button>
                </p>
              ) : members.length > 0 ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {members.map((row) => (
                    <MemberCard key={row.username} row={row} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="还没有人公开这个方向"
                  description="你可以在资料页把科目领域填上，成为第一个出现在这里的人。"
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link to="/me" search={{ tab: 'settings', section: 'profile' }}>
                        去资料页补上
                      </Link>
                    </Button>
                  }
                />
              )}
              <Pagination page={memberPage} totalPages={memberPages} onPageChange={setMemberPage} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 pt-5 text-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-primary" />
                互评覆盖
              </h2>
              <p className="leading-6 text-muted-foreground">
                {reviewerCount === undefined
                  ? '正在读互评覆盖…'
                  : reviewerCount > 0
                    ? `有 ${reviewerCount} 位互评成员自选了这个方向。`
                    : '暂时没有互评成员自选这个方向；内容整理会按话题与历史互评匹配。'}
              </p>
              <p className="text-[11px] leading-5 text-muted-foreground">
                这里只显示匿名聚合数，不展示任何互评成员身份；匿名互评下作者看不到评议人。
              </p>
              {area.subdisciplines.length > 0 ? (
                <div className="border-t pt-3">
                  <p className="mb-1.5 text-[11px] text-muted-foreground">细分方向</p>
                  <div className="flex flex-wrap gap-1.5">
                    {area.subdisciplines.slice(0, 10).map((sub) => (
                      <Badge key={sub.slug} variant="outline" className="text-[10px] font-normal">
                        {sub.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-5 text-xs leading-5 text-muted-foreground">
              <h2 className="text-sm font-semibold text-foreground">这个页面的口径</h2>
              <p>成员只列公开主页，且本人把该方向填进科目领域。</p>
              <p>作品按内容库的学科名匹配，不等于作者一定自选了这个方向。</p>
              <p>订阅后只推新作品，不会把审稿邀请或匿名互评信息混进来。</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
