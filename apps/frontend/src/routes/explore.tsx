import { useMemo, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  BookOpen,
  Compass,
  Eye,
  MessageSquare,
  Sparkles,
  ThumbsUp,
  Users,
  Bookmark,
  Clock3,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useExploreOverview, useFollowingFeed } from '@/hooks/api/use-explore'
import { useDisciplines } from '@/hooks/api/use-modules'
import { PageHeader } from '@/components/common/page-header'
import { ArticleCover } from '@/components/common/article-cover'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ExploreResourceCard, ExploreTopicCard } from '@/hooks/api/use-explore'

type ExploreTab = 'discover' | 'following'

export const Route = createFileRoute('/explore')({
  validateSearch: (search: Record<string, unknown>): { tab?: ExploreTab } => ({
    ...(search.tab === 'following' ? { tab: 'following' as const } : {}),
  }),
  component: ExplorePage,
})

function compact(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function ago(value: string | null): string {
  if (!value) return '刚刚'
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 8) return `${days} 天前`
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function ResourceCard({ resource, compactCard = false }: { resource: ExploreResourceCard; compactCard?: boolean }) {
  return (
    <Link
      to="/catalog/$resourceId"
      params={{ resourceId: String(resource.id) }}
      className="group block overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary/35"
    >
      <div className={cn('relative', compactCard ? 'flex gap-3 p-3' : '')}>
        {compactCard ? (
          <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
            <ArticleCover resource={resource} showDiscipline={false} aspect="aspect-[4/3]" />
          </div>
        ) : (
          <ArticleCover resource={resource} aspect="aspect-[16/9]" />
        )}
        <div className={cn('min-w-0', compactCard ? 'flex-1' : 'p-4')}>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{resource.discipline}</span>
            {resource.year ? <span>{resource.year}</span> : null}
          </div>
          <h3 className="mt-2 line-clamp-2 font-serif text-[17px] font-semibold leading-snug tracking-tight group-hover:text-primary">
            {resource.short_title?.trim() || resource.title}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{resource.author_name}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{compact(resource.reads)}</span>
            <span className="inline-flex items-center gap-1"><Bookmark className="h-3 w-3" />{compact(resource.saves)}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function TopicRow({ topic }: { topic: ExploreTopicCard }) {
  return (
    <Link
      to="/forum/$topicId"
      params={{ topicId: String(topic.id) }}
      className="group flex gap-3 border-b py-4 last:border-b-0"
    >
      <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {topic.author_name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="line-clamp-1 text-sm font-medium group-hover:text-primary">{topic.title}</span>
          <span className="text-[11px] text-muted-foreground">· {topic.author_name}</span>
        </span>
        <span className="mt-1 line-clamp-2 block text-[12px] leading-5 text-muted-foreground">{topic.excerpt}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{topic.reply_count} 回应</span>
          {topic.agree_count > 0 ? <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{topic.agree_count}</span> : null}
          <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{ago(topic.last_reply_at)}</span>
        </span>
      </span>
      <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-primary" />
    </Link>
  )
}

function SectionTitle({ eyebrow, title, note }: { eyebrow: string; title: string; note?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 border-b pb-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{eyebrow}</p>
        <h2 className="mt-1 font-serif text-xl tracking-tight">{title}</h2>
        {note ? <p className="mt-1 text-[11px] text-muted-foreground">{note}</p> : null}
      </div>
    </div>
  )
}

function ExplorePage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { isAuthenticated } = useAuth()
  const overview = useExploreOverview()
  const disciplines = useDisciplines()
  const tab: ExploreTab = search.tab === 'following' ? 'following' : 'discover'
  const following = useFollowingFeed(tab === 'following' && isAuthenticated)
  const [showAllFields, setShowAllFields] = useState(false)

  const stats = overview.data?.stats
  const topResources = overview.data?.top_resources ?? []
  const topTopics = overview.data?.top_topics ?? []
  const topAuthors = overview.data?.top_authors ?? []
  const topTags = overview.data?.top_tags ?? []

  const followingEmpty = useMemo(() => {
    const data = following.data
    return !data || (data.resources.length === 0 && data.topics.length === 0)
  }, [following.data])

  const switchTab = (next: ExploreTab) => {
    void navigate({ to: '/explore', search: next === 'following' ? { tab: 'following' } : {}, replace: true })
  }

  if (overview.isLoading) return <Loading />
  if (overview.isError || !overview.data) {
    return <ErrorState message="加载发现页失败" onRetry={() => overview.refetch()} />
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-8">
      <PageHeader
        title="发现"
        description="站内热读、正在讨论、活跃作者，三条路都开在下面。顺序跟着阅读和回应走，算法不替这里拿主意。"
      />

      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        {[
          { label: '在库作品', value: stats?.resources ?? 0, Icon: BookOpen },
          { label: '主题讨论', value: stats?.topics ?? 0, Icon: MessageSquare },
          { label: '成员', value: stats?.members ?? 0, Icon: Users },
          { label: '标签', value: stats?.tags ?? 0, Icon: Sparkles },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="bg-card p-3 sm:p-4">
            <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground sm:text-[10px] sm:tracking-[0.18em]">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </div>
            <p className="mt-1.5 font-serif text-xl tabular-nums sm:mt-2 sm:text-2xl">{String(value)}</p>
          </div>
        ))}
      </section>

      {(disciplines.data ?? []).length > 0 ? (
        <section className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">FIELDS</p>
              <h2 className="mt-1 font-serif text-lg tracking-tight">按领域找人</h2>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {(disciplines.data ?? []).length} 个受控方向，进去看同方向的人、最近作品和互评覆盖。
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(disciplines.data ?? []).map((discipline, index) => (
              <Link
                key={discipline.slug}
                to="/fields/$slug"
                params={{ slug: discipline.slug }}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary',
                  index >= 6 && !showAllFields ? 'hidden sm:inline-flex' : '',
                )}
              >
                {discipline.name}
                <ArrowRight className="h-3 w-3" />
              </Link>
            ))}
          </div>
          {(disciplines.data ?? []).length > 6 ? (
            <button
              type="button"
              onClick={() => setShowAllFields((value) => !value)}
              className="mt-3 inline-flex min-h-9 items-center gap-1 text-xs text-primary sm:hidden"
            >
              {showAllFields ? '收起方向' : `展开全部 ${(disciplines.data ?? []).length} 个方向`}
              <ArrowRight className={cn('h-3 w-3 transition-transform', showAllFields && 'rotate-90')} />
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-b">
        <button
          type="button"
          onClick={() => switchTab('discover')}
          className={cn(
            'relative inline-flex min-h-[44px] items-center gap-1.5 px-3 text-sm transition-colors',
            tab === 'discover' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Compass className="h-4 w-4" /> 全站发现
          {tab === 'discover' ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" /> : null}
        </button>
        <button
          type="button"
          onClick={() => switchTab('following')}
          className={cn(
            'relative inline-flex min-h-[44px] items-center gap-1.5 px-3 text-sm transition-colors',
            tab === 'following' ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Users className="h-4 w-4" /> 关注动态
          {tab === 'following' ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" /> : null}
        </button>
      </div>

      {tab === 'following' ? (
        !isAuthenticated ? (
          <EmptyState
            title="登录后，关注才会汇成一条线"
            description="关注作者、订阅方向、收藏主题帖，这里会告诉你他们最近写了什么、讨论了什么。"
            action={<Button size="sm" asChild><Link to="/login" search={{ redirect: '/explore?tab=following' }}>去登录</Link></Button>}
          />
        ) : following.isLoading ? (
          <Loading />
        ) : following.isError ? (
          <ErrorState message="加载关注动态失败" onRetry={() => following.refetch()} />
        ) : followingEmpty ? (
          <EmptyState
            title="关注动态还空着"
            description="去个人主页关注一位作者，或在主题帖里点「关注」；有新回应时，会出现在这里。"
            action={<Button size="sm" variant="outline" asChild><Link to="/forum">去主题论坛</Link></Button>}
          />
        ) : (
          <div className="space-y-10">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="rounded-full border bg-card px-3 py-1">关注作者 {following.data?.followed_authors ?? 0}</span>
              <span className="rounded-full border bg-card px-3 py-1">订阅方向 {following.data?.subscribed_disciplines ?? 0}</span>
              <span className="rounded-full border bg-card px-3 py-1">关注主题 {following.data?.followed_topics ?? 0}</span>
            </div>
            {following.data?.resources.length ? (
              <section>
                <SectionTitle eyebrow="FROM PEOPLE YOU FOLLOW" title="他们最近写的" note="按发布时间倒序，只列已公开作品。" />
                <div className="grid gap-3 md:grid-cols-2">
                  {following.data.resources.map((resource) => (
                    <ResourceCard key={resource.id} resource={resource} compactCard />
                  ))}
                </div>
              </section>
            ) : null}
            {following.data?.topics.length ? (
              <section>
                <SectionTitle eyebrow="WATCHED CONVERSATIONS" title="关注的讨论有新动静" />
                <div className="rounded-xl border bg-card px-4">
                  {following.data.topics.map((topic) => <TopicRow key={topic.id} topic={topic} />)}
                </div>
              </section>
            ) : null}
          </div>
        )
      ) : (
        <div className="space-y-10">
          <section>
            <SectionTitle eyebrow="ATTENTION, NOT EDITORIAL" title="站内热读" note="阅读、下载、收藏加在一起算；数据不够时，退回最新。" />
            {topResources.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {topResources.map((resource) => <ResourceCard key={resource.id} resource={resource} />)}
              </div>
            ) : (
              <EmptyState title="内容库还没有公开作品" description="去内容库看看，或者写下第一篇。" action={<Button size="sm" asChild><Link to="/catalog">去内容库</Link></Button>} />
            )}
          </section>

          <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
            <section>
              <SectionTitle eyebrow="LIVE THREADS" title="正在讨论" note="回应多、赞同多的靠前；刚开的帖，去「最新」看。" />
              <div className="rounded-xl border bg-card px-4">
                {topTopics.length ? topTopics.map((topic) => <TopicRow key={topic.id} topic={topic} />) : (
                  <p className="py-8 text-sm text-muted-foreground">还没有公开讨论。去主题论坛起一个话头。</p>
                )}
              </div>
            </section>

            <div className="space-y-8">
              <section>
                <SectionTitle eyebrow="PEOPLE AT THE TABLE" title="活跃作者" note="看已公开作品和站内阅读；粉丝数不参与。" />
                <div className="space-y-1">
                  {topAuthors.length ? topAuthors.map((author, index) => (
                    <Link
                      key={author.username}
                      to="/u/$username"
                      params={{ username: author.username }}
                      className="group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/40"
                    >
                      <span className="w-5 text-center font-mono text-[11px] text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                      {author.avatar_url ? (
                        <img src={author.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {(author.display_name || author.username).slice(0, 1)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium group-hover:text-primary">{author.display_name || author.username}</span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{author.works} 篇 · {compact(author.reads)} 阅读 · {author.followers} 关注</span>
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary" />
                    </Link>
                  )) : (
                    <p className="py-3 text-sm text-muted-foreground">还没有绑定作者的作品。</p>
                  )}
                </div>
              </section>

              <section>
                <SectionTitle eyebrow="TAG MAP" title="标签地图" />
                <div className="flex flex-wrap gap-2">
                  {topTags.map((tag) => (
                    <Link
                      key={tag.name}
                      to="/search"
                      search={{ q: tag.name }}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                    >
                      {tag.name}<span className="tabular-nums opacity-60">{tag.count}</span>
                    </Link>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
