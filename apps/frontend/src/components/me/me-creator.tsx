import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, Bookmark, Download, Eye, MessageSquare, PenLine, Users } from 'lucide-react'
import { useCreatorOverview } from '@/hooks/api/use-creator'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Button } from '@/components/ui/button'

function count(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function ago(value: string): string {
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function PageViewTrend({
  daily,
  total,
}: {
  daily: Array<{ date: string; views: number }>
  total: number
}) {
  const max = Math.max(1, ...daily.map((d) => d.views))
  const peak = daily.length > 0 ? daily.reduce((best, d) => (d.views > best.views ? d : best), daily[0]) : null
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">TRAFFIC</p>
          <h2 className="mt-1 font-serif text-xl tracking-tight">近 30 天页面访问</h2>
        </div>
        <div className="text-right">
          <p className="font-serif text-2xl tabular-nums">{count(total)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {peak && peak.views > 0 ? `单日最高 ${peak.views} 次 · ${peak.date.slice(5).replace('-', '/')}` : '还没有访问记录'}
          </p>
        </div>
      </div>
      <div
        className="mt-4 flex h-20 items-end gap-[2px] rounded-lg border bg-muted/20 px-2 py-2"
        aria-label={`近 30 天页面访问趋势，共 ${total} 次`}
      >
        {daily.map((day) => (
          <div
            key={day.date}
            className={`min-w-0 flex-1 rounded-t-[2px] ${day.views > 0 ? 'bg-primary/70' : 'bg-border'}`}
            style={{ height: day.views > 0 ? `${Math.max(6, (day.views / max) * 100)}%` : '2px' }}
            title={`${day.date}：${day.views} 次`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{daily[0]?.date.slice(5).replace('-', '/')}</span>
        <span>页面打开次数，匿名访客也计入；不记录身份</span>
        <span>{daily[daily.length - 1]?.date.slice(5).replace('-', '/')}</span>
      </div>
    </section>
  )
}

export function MeCreator() {
  const query = useCreatorOverview()
  if (query.isLoading) return <Loading />
  if (query.isError || !query.data) return <ErrorState message="加载创作数据失败" onRetry={() => query.refetch()} />
  const data = query.data

  if (data.published === 0) {
    return (
      <EmptyState
        title="还没有已发表的作品"
        description="发表第一篇后，这里会出现阅读、下载、收藏、评论和关注者的汇总。"
        action={<Button size="sm" asChild><Link to="/submissions/new">写一篇</Link></Button>}
      />
    )
  }

  const metrics = [
    { label: '阅读', value: data.totals.reads, Icon: Eye },
    { label: '下载', value: data.totals.downloads, Icon: Download },
    { label: '收藏', value: data.totals.saves, Icon: Bookmark },
    { label: '评论', value: data.totals.comments, Icon: MessageSquare },
  ]

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">CREATOR</p>
            <h2 className="mt-1 font-serif text-xl tracking-tight">创作数据</h2>
            <p className="mt-1 text-xs text-muted-foreground">只统计已公开作品；访客身份不记录，只有聚合数字。</p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to="/submissions">作品台 <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
          {metrics.map(({ label, value, Icon }) => (
            <div key={label} className="bg-card p-4">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />{label}
              </div>
              <p className="mt-2 font-serif text-2xl tabular-nums">{count(value)}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full border bg-card px-3 py-1">{data.published} 篇已公开</span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-card px-3 py-1"><Users className="h-3 w-3" />{data.followers} 关注者</span>
          <span className="rounded-full border bg-card px-3 py-1">{data.forum_topics} 主题帖 · {data.forum_replies} 回应</span>
        </div>
      </section>

      <PageViewTrend daily={data.page_views?.daily ?? []} total={data.page_views?.total ?? 0} />

      <section>
        <div className="flex items-end justify-between gap-3 border-b pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">WORK BY WORK</p>
            <h2 className="mt-1 font-serif text-xl tracking-tight">作品表现</h2>
          </div>
          <span className="text-[11px] text-muted-foreground">近 10 篇</span>
        </div>
        <div className="divide-y">
          {data.works.map((work) => (
            <Link
              key={work.id}
              to="/catalog/$resourceId"
              params={{ resourceId: String(work.id) }}
              className="group flex items-center gap-3 py-3.5"
            >
              {work.cover_image ? (
                <img src={work.cover_image} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" />
              ) : (
                <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><BookOpen className="h-4 w-4" /></span>
              )}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 text-sm font-medium group-hover:text-primary">{work.title}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{work.discipline} · {new Date(work.published_at).toLocaleDateString('zh-CN')}</span>
              </span>
              <span className="hidden shrink-0 items-center gap-3 text-[11px] text-muted-foreground sm:flex">
                <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{count(work.reads)}</span>
                <span className="inline-flex items-center gap-1"><Download className="h-3.5 w-3.5" />{count(work.downloads)}</span>
                <span className="inline-flex items-center gap-1"><Bookmark className="h-3.5 w-3.5" />{count(work.saves)}</span>
                <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{work.comments}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-3 border-b pb-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">RECENT COMMENTS</p>
            <h2 className="mt-1 font-serif text-xl tracking-tight">最近评论</h2>
          </div>
          <span className="text-[11px] text-muted-foreground">只显示未下架评论</span>
        </div>
        {data.recent_comments.length ? (
          <div className="divide-y">
            {data.recent_comments.map((comment) => (
              <div key={comment.id} className="py-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <Link to="/u/$username" params={{ username: comment.author_username }} className="font-medium text-foreground/80 hover:text-primary">
                    {comment.author_display_name || comment.author_username}
                  </Link>
                  <span>评论了</span>
                  <Link to="/catalog/$resourceId" params={{ resourceId: String(comment.resource_id) }} className="hover:text-primary">
                    《{comment.resource_title}》
                  </Link>
                  <span>· {ago(comment.created_at)}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-muted-foreground">{comment.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-sm text-muted-foreground">还没有读者评论。可以在作品页底部留一句讨论引子。</p>
        )}
      </section>

      <div className="flex justify-end">
        <Button size="sm" asChild>
          <Link to="/submissions/new"><PenLine className="h-3.5 w-3.5" />继续写</Link>
        </Button>
      </div>
    </div>
  )
}
