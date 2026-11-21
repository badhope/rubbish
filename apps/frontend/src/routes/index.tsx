import { type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Bell, ChevronRight, LogIn, PenLine } from 'lucide-react'
import '@fontsource-variable/playfair-display'
import { useAuth } from '@/hooks/use-auth'
import { useCatalogStats, useEditorialPicks, useResources } from '@/hooks/api/use-modules'
import { formatAuthors } from '@/lib/utils'
import { AnnouncementChip, AnnouncementDialog, useAnnouncementPortal } from '@/components/common/announcement-dialog'
import { AppearanceMenu } from '@/components/appearance-menu'
import { ArticleCover } from '@/components/common/article-cover'
import { BrandMark } from '@/components/common/brand-mark'
import { HeroBackdrop } from '@/components/common/hero-backdrop'
import { ScrollCue } from '@/components/common/scroll-cue'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/')({
  component: HomePage,
})

const DISPLAY_FONT =
  "'Playfair Display Variable', Georgia, 'Songti SC', 'DejaVu Serif', serif"

const READING_PATHS = {
  start: {
    label: '第一次来',
    title: '从这三篇开始',
    note: '不用先懂站规，先感受这里能认真到什么程度。',
  },
  research: {
    label: '科研处境',
    title: '如果你也在实验室里挣扎',
    note: '导师、论文、就业、精神状态；不提供鸡汤，只提供拆解。',
  },
  weird: {
    label: '怪问题也认真',
    title: '把荒诞当成方法',
    note: '设定可以离谱，材料、推理和边界不能糊弄。',
  },
} as const

function displayTitle(resource: { short_title?: string | null; title: string }): string {
  return resource.short_title?.trim() || resource.title
}

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
  const editorialQuery = useEditorialPicks(10)
  const latestQuery = useResources({
    track: 'paper',
    page: 1,
    page_size: 1,
    sort: 'created_at',
    order: 'desc',
  })
  const stats = useCatalogStats('paper')
  const funStats = useCatalogStats('essay')

  const picks = editorialQuery.data?.data ?? []
  const featured = picks[0] ?? latestQuery.data?.data?.[0]
  const routePicks = picks.slice(1)
  const serious = stats.data?.by_paper_kind?.serious
  const absurd = stats.data?.by_paper_kind?.absurd
  const paperTotal = stats.data?.by_type?.paper
  const funTotal = funStats.data?.total
  const pathGroups = (Object.keys(READING_PATHS) as Array<keyof typeof READING_PATHS>)
    .map((key) => ({
      key,
      ...READING_PATHS[key],
      items: routePicks.filter((item) => item.reading_path === key),
    }))
    .filter((group) => group.items.length > 0)


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
                Absurd Research Community
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
                aria-label={notice.seen ? '查看社区公告' : '查看未读的社区公告'}
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
            开放文章 · 荒诞研究
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
            把不正经的问题，认真研究一遍。提问、立项、记录、失败、复盘，都在这里。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="button-shine h-12 px-6 text-sm sm:h-14 sm:px-7 sm:text-base">
              <Link to="/forum">
                进社区 <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6 text-sm sm:h-14 sm:px-7 sm:text-base">
              <Link to="/submissions/new">
                <PenLine className="h-4 w-4 sm:h-5 sm:w-5" /> 写文章
              </Link>
            </Button>
          </div>
          <div className="mt-12 sm:mt-16">
            <ScrollCue label="向下阅读" />
          </div>
        </div>
      </section>

      {/* 本周主稿：编辑推荐优先于“最新发布”。 */}
      <section className="mx-auto w-full max-w-[1320px] px-5 py-14 sm:px-8 sm:py-20">
        <SectionHeading
          label="Editor's pick · 编辑推荐"
          title="先读这一篇"
          action={
            <Link to="/catalog" search={{ track: 'paper' }} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary">
              全部文章 <ChevronRight className="h-4 w-4" />
            </Link>
          }
        />
        {editorialQuery.isLoading || latestQuery.isLoading ? (
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
                {featured.featured_rank ? (
                  <>
                    <span className="text-primary">编辑推荐 #{featured.featured_rank}</span>
                    <span aria-hidden>·</span>
                  </>
                ) : null}
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
                {displayTitle(featured)}
              </Link>
              {featured.short_title && featured.short_title.trim() !== featured.title ? (
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{featured.title}</p>
              ) : null}
              {featured.editor_note ? (
                <blockquote className="mt-5 border-l-2 border-primary/50 pl-4 text-[15px] leading-7 text-foreground/85">
                  {featured.editor_note}
                </blockquote>
              ) : null}
              {featured.abstract ? (
                <p className="mt-4 line-clamp-3 text-[15px] leading-7 text-muted-foreground">
                  {featured.abstract}
                </p>
              ) : null}
              <p className="mt-5 text-sm text-foreground/80">{formatAuthors(featured.authors, 3)}</p>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Link
                  to="/catalog/$resourceId"
                  params={{ resourceId: String(featured.id) }}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  阅读全文 <ArrowRight className="h-4 w-4" />
                </Link>
                {featured.discussion_prompt ? (
                  <Link
                    to="/forum"
                    search={{
                      category: 'paper',
                      paperId: featured.id,
                      paperTitle: featured.title,
                      prompt: featured.discussion_prompt,
                    }}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"
                  >
                    带着问题去讨论 <ChevronRight className="h-4 w-4" />
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="border-y border-border/70 py-10 text-sm text-muted-foreground">
            本周研究还在整理，可以先去文章目录读已发布的文章，或去社区参与讨论。
            <Link to="/catalog" className="ml-2 text-primary hover:underline">
              打开文章目录
            </Link>
          </div>
        )}
      </section>

      {/* 三条阅读路线：不是按分类堆文章，而是按“你现在从哪来”给入口。 */}
      {pathGroups.length > 0 && (
        <section className="border-y border-border/70 bg-muted/20">
          <div className="mx-auto w-full max-w-[1320px] px-5 py-14 sm:px-8 sm:py-20">
            <SectionHeading
              label="Reading paths · 阅读路线"
              title="按你的处境选一条"
              action={
                <Link to="/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary">
                  自由浏览 <ChevronRight className="h-4 w-4" />
                </Link>
              }
            />
            <div className="grid gap-5 md:grid-cols-3">
              {pathGroups.map((group) => (
                <div key={group.key} className="rounded-xl border bg-background p-5">
                  <p className="text-[10px] uppercase tracking-[0.28em] text-primary">{group.label}</p>
                  <h3 className="mt-2 font-serif text-2xl tracking-tight">{group.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{group.note}</p>
                  <div className="mt-5 divide-y border-t">
                    {group.items.map((item, index) => (
                      <Link
                        key={item.id}
                        to="/catalog/$resourceId"
                        params={{ resourceId: String(item.id) }}
                        className="group flex items-start gap-3 py-3 transition-colors hover:text-primary"
                      >
                        <span className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-6">{displayTitle(item)}</span>
                          {item.editor_note ? (
                            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                              {item.editor_note}
                            </span>
                          ) : null}
                        </span>
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 目录入口：只给索引行，不再把学科、文章和统计做成卡片墙。 */}
      <section className="border-y border-border/70 bg-muted/20">
        <div className="mx-auto w-full max-w-[1100px] px-5 py-14 sm:px-8 sm:py-20">
          <SectionHeading
            label="Articles · 文章"
            title="从哪读起"
            action={
              <div className="flex items-center gap-4">
                <Link to="/issues" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary">
                  按卷期浏览 <ChevronRight className="h-4 w-4" />
                </Link>
                <Link to="/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary">
                  全部文章 <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            }
          />
          <div className="divide-y divide-border/70 border-t border-border/70">
            <Link to="/catalog" search={{ kind: 'serious' }} className="group flex items-center gap-4 py-5 sm:gap-6">
              <span className="w-10 shrink-0 font-mono text-sm text-muted-foreground">01</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-serif text-2xl transition-colors group-hover:text-primary sm:text-3xl">实证研究</span>
                  <span className="text-xs text-muted-foreground">
                    <Count value={serious} ready={Boolean(stats.data)} /> 篇
                  </span>
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  真实问题、可核查材料、完整过程；先把事情做清楚。
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
            <Link to="/catalog" search={{ kind: 'absurd' }} className="group flex items-center gap-4 py-5 sm:gap-6">
              <span className="w-10 shrink-0 font-mono text-sm text-muted-foreground">02</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-serif text-2xl transition-colors group-hover:text-primary sm:text-3xl">荒诞研究</span>
                  <span className="text-xs text-muted-foreground">
                    <Count value={absurd} ready={Boolean(stats.data)} /> 篇
                  </span>
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  一本正经地研究不可能的问题；设定清楚，推理完整。
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
                  小说、随笔、评论、诗歌；研究之外的另一块黑板。
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
            <Link to="/issues" className="group flex items-center gap-4 py-5 sm:gap-6">
              <span className="w-10 shrink-0 font-mono text-sm text-muted-foreground">04</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-serif text-2xl transition-colors group-hover:text-primary sm:text-3xl">卷期浏览</span>
                  <span className="text-xs text-muted-foreground">按卷、期归档</span>
                </span>
                <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                  按卷、期顺序读已发表的文章。
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-xs text-muted-foreground">
              已收录 <Count value={paperTotal} ready={Boolean(stats.data)} /> 篇研究文章 ·{' '}
              <Count value={funTotal} ready={Boolean(funStats.data)} /> 篇创作
            </span>
            <Link to="/catalog" search={{ sort: 'random' }} className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-primary">
              换一批 <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* 发布：最后一个主任务，不把表单铺在首页。 */}
      <section className="border-t border-border/70 bg-primary text-primary-foreground">
        <div className="mx-auto grid w-full max-w-[1100px] gap-8 px-5 py-14 sm:px-8 sm:py-20 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-primary-foreground/60">Publish an article</p>
            <h2 className="mt-2 font-serif text-3xl sm:text-4xl">把你的文章放上来</h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-primary-foreground/75">
              文章走投稿与审核，短帖发在社区；两条发布入口分开，也不再混排。先写清楚要讲的事，发布后公开，不收费。
            </p>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <Button asChild size="lg" variant="secondary" className="h-12 px-6">
              <Link to="/submissions/new">
                {isAuthenticated ? '去写文章' : '免费注册写文章'} <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 border-primary-foreground/30 bg-transparent px-6 text-primary-foreground hover:bg-primary-foreground/10">
              <Link to="/guide" search={{ tab: 'authors' }}>社区指南</Link>
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
              Absurd Research Community · 荒诞科研社区
              <br />
              独立科研社区 · 不收取任何费用
            </p>
          </div>
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">阅读</p>
            <ul className="space-y-1.5 text-sm">
              <li><Link to="/catalog" className="hover:text-primary">全部文章</Link></li>
              <li><Link to="/guide" search={{ tab: 'authors' }} className="hover:text-primary">社区指南</Link></li>
              <li><Link to="/guide" search={{ tab: 'policies' }} className="hover:text-primary">社区公约</Link></li>
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
              <li><Link to="/about" search={{ tab: 'about' }} className="hover:text-primary">关于社区</Link></li>
              <li><Link to="/guide" search={{ tab: 'help' }} className="hover:text-primary">使用帮助</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/70">
          <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-muted-foreground sm:px-8">
            <span>© {new Date().getFullYear()} Rubbish · Absurd Research Community</span>
            <span>认真做，大胆荒诞，公开聊。</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
