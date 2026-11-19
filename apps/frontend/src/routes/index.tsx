import { type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Bell, ChevronRight, LogIn, PenLine } from 'lucide-react'
import '@fontsource-variable/playfair-display'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'
import { useCatalogStats, useResources } from '@/hooks/api/use-modules'
import { formatAuthors } from '@/lib/utils'
import { AnnouncementChip, AnnouncementDialog, useAnnouncementPortal } from '@/components/common/announcement-dialog'
import { AppearanceMenu } from '@/components/appearance-menu'
import { ArticleCover } from '@/components/common/article-cover'
import { BrandMark } from '@/components/common/brand-mark'
import { HeroBackdrop } from '@/components/common/hero-backdrop'
import { ScrollCue } from '@/components/common/scroll-cue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/')({
  component: HomePage,
})

const DISPLAY_FONT =
  "'Playfair Display Variable', Georgia, 'Noto Serif SC Site', 'Songti SC', 'DejaVu Serif', serif"

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function SectionHeading({
  label,
  title,
  action,
}: {
  label: string
  title: string
  action?: ReactNode
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-3">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.3em] text-primary">{label}</p>
        <h2 className="mt-1.5 text-2xl sm:text-3xl" style={{ fontFamily: DISPLAY_FONT }}>
          {title}
        </h2>
      </div>
      {action}
    </div>
  )
}

function Count({ value, ready }: { value: number | undefined; ready: boolean }) {
  return <span className="tabular-nums">{ready ? value ?? 0 : '…'}</span>
}

function HomePage() {
  const { isAuthenticated } = useAuth()
  const notice = useAnnouncementPortal()
  const featuredQuery = useResources({
    track: 'paper',
    page: 1,
    page_size: 1,
    sort: 'created_at',
    order: 'desc',
  })
  const stats = useCatalogStats('paper')
  const funStats = useCatalogStats('essay')

  const featured = featuredQuery.data?.data?.[0]
  const serious = stats.data?.by_paper_kind?.serious
  const absurd = stats.data?.by_paper_kind?.absurd
  const paperTotal = stats.data?.by_type?.paper
  const funTotal = funStats.data?.total


  return (
    <div className="min-h-screen bg-background text-foreground">
      {notice.announcement && (
        <AnnouncementDialog
          announcement={notice.announcement}
          open={notice.open}
          onOpenChange={notice.onOpenChange}
        />
      )}

      <header className="border-b border-border/70 bg-background/90">
        <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-4 px-5 py-2.5 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <BrandMark decorative className="h-7 w-7" />
            <span className="flex flex-col leading-none">
              <span className="font-serif text-base font-semibold tracking-tight">Rubbish</span>
              <span className="mt-1 hidden text-[9px] uppercase tracking-[0.28em] text-muted-foreground sm:block">
                Absurd Academic Writing Forum
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:gap-2.5">
            <span className="hidden sm:inline-flex">
              <AnnouncementChip
                announcement={notice.announcement}
                seen={notice.seen}
                onOpen={() => notice.setOpen(true)}
              />
            </span>
            {notice.announcement && (
              <button
                type="button"
                onClick={() => notice.setOpen(true)}
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background text-muted-foreground transition-colors hover:text-foreground sm:hidden"
                aria-label={notice.seen ? '查看编辑部公告' : '查看未读的编辑部公告'}
              >
                <Bell className="h-3.5 w-3.5" />
                {!notice.seen && (
                  <span aria-hidden className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive" />
                )}
              </button>
            )}
            <AppearanceMenu />
            {isAuthenticated ? (
              <Link to="/me" className="inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground">
                进入我的 <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <>
                <Link to="/login" className="inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground">
                  <LogIn className="h-3 w-3" /> 登录
                </Link>
                <Link to="/register" className="hidden whitespace-nowrap transition-colors hover:text-foreground sm:inline">
                  注册
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* 封面：首屏只放刊名、副标题和两个动作。 */}
      <section className="relative overflow-hidden border-b border-border/70">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(22,50,79,0.08),transparent_70%)] dark:bg-[radial-gradient(60%_50%_at_50%_0%,rgba(199,162,75,0.10),transparent_70%)]"
        />
        <HeroBackdrop />
        <div className="relative mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-[1200px] flex-col items-center justify-center px-5 pb-16 pt-10 text-center sm:px-8">
          <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.35em] text-muted-foreground">
            <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-primary" />
            Open Forum · Absurd Academia
            <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-primary" />
          </p>
          <h1 className="mt-6 flex flex-wrap items-center justify-center gap-3 sm:gap-6">
            <BrandMark decorative className="h-11 w-11 sm:h-24 sm:w-24" />
            <span
              className="hero-title type-hero whitespace-nowrap tracking-tight"
              style={{ fontFamily: DISPLAY_FONT, fontWeight: 600 }}
            >
              Rubbish
            </span>
          </h1>
          <p className="mt-5 max-w-4xl text-[15px] leading-7 text-muted-foreground sm:text-xl sm:leading-9">
            把荒诞写成论文，把论文写成现场。写下来，发出去，让人接。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="button-shine h-12 px-6 text-sm sm:h-14 sm:px-7 sm:text-base">
              <Link to="/forum">
                逛论坛 <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6 text-sm sm:h-14 sm:px-7 sm:text-base">
              <Link to="/forum" search={{ compose: '1' }}>
                <PenLine className="h-4 w-4 sm:h-5 sm:w-5" /> 发布作品
              </Link>
            </Button>
          </div>
          <div className="mt-12 sm:mt-16">
            <ScrollCue label="向下阅读" />
          </div>
        </div>
      </section>

      {/* 本期主稿：一个区块只给一篇，不做并列卡片。 */}
      <section className="mx-auto w-full max-w-[1320px] px-5 py-14 sm:px-8 sm:py-20">
        <SectionHeading
          label="Featured · 本周精选"
          title="先读这一篇"
          action={
            <Link to="/catalog" search={{ track: 'paper' }} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary">
              全部作品 <ChevronRight className="h-4 w-4" />
            </Link>
          }
        />
        {featuredQuery.isLoading ? (
          <div className="grid gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Skeleton className="aspect-[4/3] w-full" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-4/5" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        ) : featured ? (
          <div className="grid items-start gap-7 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-10">
            <Link
              to="/catalog/$resourceId"
              params={{ resourceId: String(featured.id) }}
              className="group block overflow-hidden bg-muted"
            >
              <ArticleCover
                resource={featured}
                aspect="aspect-[4/3] sm:aspect-[16/10]"
                priority
                showDiscipline={false}
                className="transition-transform duration-500 group-hover:scale-[1.02]"
              />
            </Link>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <span>{featured.discipline || '跨学科'}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{featured.year}</span>
                <span aria-hidden>·</span>
                <span>{formatDate(featured.created_at)}</span>
              </div>
              <Link
                to="/catalog/$resourceId"
                params={{ resourceId: String(featured.id) }}
                className="mt-4 block font-serif text-3xl leading-tight tracking-tight transition-colors hover:text-primary sm:text-4xl"
              >
                {featured.title}
              </Link>
              {featured.abstract ? (
                <p className="mt-4 line-clamp-4 text-[15px] leading-7 text-muted-foreground">
                  {featured.abstract}
                </p>
              ) : null}
              <p className="mt-5 text-sm text-foreground/80">{formatAuthors(featured.authors, 3)}</p>
              <Link
                to="/catalog/$resourceId"
                params={{ resourceId: String(featured.id) }}
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                阅读全文 <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="border-y border-border/70 py-10 text-sm text-muted-foreground">
            本周精选还在整理，先去论坛看看大家在写什么。
            <Link to="/forum" className="ml-2 text-primary hover:underline">
              打开论坛
            </Link>
          </div>
        )}
      </section>

      {/* 目录入口：只给索引行，不再把学科、文章和统计做成卡片墙。 */}
      <section className="border-y border-border/70 bg-muted/20">
        <div className="mx-auto w-full max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <SectionHeading
            label="Works · 作品"
            title="三种读法"
            action={
              <Link to="/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary">
                全部作品 <ChevronRight className="h-4 w-4" />
              </Link>
            }
          />
          <div className="divide-y divide-border/70 border-t border-border/70">
            <Link to="/catalog" search={{ kind: 'serious' }} className="group flex items-center gap-4 py-5 sm:gap-6">
              <span className="w-10 shrink-0 font-mono text-sm text-muted-foreground">01</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-serif text-2xl transition-colors group-hover:text-primary sm:text-3xl">严肃写作</span>
                  <span className="text-xs text-muted-foreground">
                    <Count value={serious} ready={Boolean(stats.data)} /> 篇
                  </span>
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  真实问题、可核查材料、正经论证；先把事情写清楚。
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
            <Link to="/catalog" search={{ kind: 'absurd' }} className="group flex items-center gap-4 py-5 sm:gap-6">
              <span className="w-10 shrink-0 font-mono text-sm text-muted-foreground">02</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-serif text-2xl transition-colors group-hover:text-primary sm:text-3xl">荒诞论文体</span>
                  <span className="text-xs text-muted-foreground">
                    <Count value={absurd} ready={Boolean(stats.data)} /> 篇
                  </span>
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  用论文格式一本正经地论证荒诞命题；越认真越好笑。
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
            <Link to="/catalog" search={{ track: 'essay' }} className="group flex items-center gap-4 py-5 sm:gap-6">
              <span className="w-10 shrink-0 font-mono text-sm text-muted-foreground">03</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-serif text-2xl transition-colors group-hover:text-primary sm:text-3xl">自由创作</span>
                  <span className="text-xs text-muted-foreground">
                    <Count value={funTotal} ready={Boolean(funStats.data)} /> 篇
                  </span>
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  小说、随笔、评论、诗歌与指南；不套论文体，只谈写得好不好。
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-xs text-muted-foreground">
              已收录 <Count value={paperTotal} ready={Boolean(stats.data)} /> 篇写作 ·{' '}
              <Count value={funTotal} ready={Boolean(funStats.data)} /> 篇自由创作
            </span>
            <Link to="/catalog" search={{ sort: 'issue' }} className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-primary">
              换一批 <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 编辑部手记：不占一整墙，只留一段可读的判断。 */}
      <section className="mx-auto w-full max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
        <SectionHeading label="Editor's Note · 论坛手记" title="这个论坛怎么长出来" />
        <div className="grid gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] md:gap-12">
          <blockquote className="border-l-2 border-primary pl-5 sm:pl-7">
            <p className="font-serif text-2xl leading-relaxed sm:text-3xl">
              好笑的荒诞，也值得被认真对待；好读的坏学术，也应该有地方被读完。
            </p>
            <footer className="mt-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              —— Rubbish 论坛
            </footer>
          </blockquote>
          <div className="text-sm leading-7 text-muted-foreground">
            <p>
              论文体之外，还有读者。我们替不够正经、但写得好玩、脑洞可核查的荒诞，
              留一个能被认真读完的位置。
            </p>
            <Link to="/about" search={{ tab: 'about' }} className="mt-4 inline-flex items-center gap-1 text-primary hover:underline">
              关于论坛与版主 <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <ForumPulse />

      {/* 投稿：最后一个主任务，不把表单铺在首页。 */}
      <section className="border-t border-border/70 bg-primary text-primary-foreground">
        <div className="mx-auto grid w-full max-w-[1100px] gap-8 px-5 py-14 sm:px-8 sm:py-20 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-primary-foreground/60">Publish</p>
            <h2 className="mt-2 font-serif text-3xl sm:text-4xl">把你的荒诞论文体放上来</h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-primary-foreground/75">
              长文与短帖共用一套发布入口；先写标题，再把正文贴进来。发布后全文开放，不收费用。
            </p>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <Button asChild size="lg" variant="secondary" className="h-12 px-6">
              <Link to="/forum" search={{ compose: '1' }}>
                {isAuthenticated ? '去论坛发布' : '免费注册发帖'} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 border-primary-foreground/30 bg-transparent px-6 text-primary-foreground hover:bg-primary-foreground/10">
              <Link to="/guide" search={{ tab: 'authors' }}>论坛指南</Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="bg-background">
        <div className="mx-auto grid w-full max-w-[1100px] gap-8 px-5 py-10 text-sm sm:px-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark decorative className="h-7 w-7" />
              <span className="font-serif text-xl font-semibold">Rubbish</span>
            </div>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              Absurd Academic Writing Forum · 荒诞论文体论坛
              <br />
              独立创作论坛 · 不收取任何费用
            </p>
          </div>
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">阅读</p>
            <ul className="space-y-1.5 text-sm">
              <li><Link to="/catalog" className="hover:text-primary">全部作品</Link></li>
              <li><Link to="/guide" search={{ tab: 'authors' }} className="hover:text-primary">论坛指南</Link></li>
              <li><Link to="/guide" search={{ tab: 'policies' }} className="hover:text-primary">论坛公约</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">联系</p>
            <ul className="space-y-1.5 text-sm">
              <li>
                <a href="mailto:info@rubbishasci.cn" className="break-all hover:text-primary">
                  info@rubbishasci.cn
                </a>
              </li>
              <li className="text-muted-foreground">QQ 群：1084870548</li>
              <li><Link to="/about" search={{ tab: 'about' }} className="hover:text-primary">关于论坛</Link></li>
              <li><Link to="/guide" search={{ tab: 'help' }} className="hover:text-primary">使用帮助</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/70">
          <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-muted-foreground sm:px-8">
            <span>© {new Date().getFullYear()} Rubbish · Absurd Academic Writing Forum</span>
            <span>认真写，大胆荒诞，公开读。</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

function ForumPulse() {
  const q = useQuery({
    queryKey: ['home', 'forum-pulse'],
    queryFn: async () => (await api.get('/forum/topics', { params: { page_size: 5 } })).data,
  })
  const topics = (q.data?.data ?? []) as Array<{
    id: number
    title: string
    category: string
    reply_count: number
    last_reply_at: string | null
    author: { username: string; display_name?: string | null; avatar_url?: string | null } | null
  }>
  if (topics.length === 0) return null

  const label: Record<string, string> = {
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
  const rel = (iso: string | null) => {
    if (!iso) return ''
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    if (m < 60) return `${Math.max(1, m)} 分钟前`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} 小时前`
    return `${Math.floor(h / 24)} 天前`
  }

  return (
    <section className="mx-auto w-full max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
      <SectionHeading
        label="Forum · 动态"
        title="正在讨论"
        action={
          <Link to="/forum" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary">
            进入讨论 <ChevronRight className="h-4 w-4" />
          </Link>
        }
      />
      <div className="divide-y divide-border/70 border-t border-border/70">
        {topics.map((t) => (
          <Link
            key={t.id}
            to="/forum/$topicId"
            params={{ topicId: String(t.id) }}
            className="group flex items-start gap-3 py-4 transition-colors hover:text-primary"
          >
            <Badge variant="outline" className="mt-0.5 shrink-0">{label[t.category] ?? t.category}</Badge>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1 text-sm font-medium">{t.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t.author?.display_name || t.author?.username || '匿名'} · {t.reply_count} 回复
                {t.last_reply_at ? ` · 最后活跃 ${rel(t.last_reply_at)}` : ''}
              </span>
            </span>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </section>
  )
}
