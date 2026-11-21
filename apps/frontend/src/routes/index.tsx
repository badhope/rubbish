import { type FormEvent, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Compass,
  FileText,
  Layers3,
  LogIn,
  MessagesSquare,
  PenLine,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import '@fontsource-variable/playfair-display'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'
import { useCatalogStats, useEditorialPicks } from '@/hooks/api/use-modules'
import { formatAuthors } from '@/lib/utils'
import { AnnouncementChip, AnnouncementDialog, useAnnouncementPortal } from '@/components/common/announcement-dialog'
import { AppearanceMenu } from '@/components/appearance-menu'
import { ArticleCover } from '@/components/common/article-cover'
import { BrandMark } from '@/components/common/brand-mark'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/')({
  component: HomePage,
})

const DISPLAY_FONT =
  "'Playfair Display Variable', Georgia, 'Songti SC', 'DejaVu Serif', serif"

interface HomeTopic {
  id: number
  title: string
  board_name: string | null
  reply_count: number
  last_reply_at: string | null
  created_at: string
  author: { display_name?: string | null; username: string } | null
}

const FIRST_STEPS = [
  {
    no: '01',
    icon: BookOpen,
    title: '读一篇',
    body: '不用登录，先看看这里的人在认真研究什么。',
    to: '/catalog',
    label: '打开内容库',
  },
  {
    no: '02',
    icon: MessagesSquare,
    title: '说一句',
    body: '读到想接的话，去讨论区回一句，或者自己开个问题。',
    to: '/forum',
    label: '去讨论区',
  },
  {
    no: '03',
    icon: PenLine,
    title: '发一篇',
    body: '长文进内容库，短帖进讨论区。注册后直接发，不收费。',
    to: '/submissions/new',
    label: '开始写',
  },
  {
    no: '04',
    icon: Compass,
    title: '不知道怎么用',
    body: '“怎么用”里有全站地图、四步上手和旧名字对照。',
    to: '/guide',
    label: '看 3 分钟上手',
  },
] as const

const CONTENT_KINDS = [
  {
    label: '研究长文',
    body: '真实问题、可核查材料、完整过程。',
    to: '/catalog',
    search: { kind: 'serious' as const },
    icon: FileText,
  },
  {
    label: '荒诞研究',
    body: '设定清楚、推理完整，结论可以离谱。',
    to: '/catalog',
    search: { kind: 'absurd' as const },
    icon: Sparkles,
  },
  {
    label: '自由创作',
    body: '小说、随笔、评论、诗歌；不套研究格式。',
    to: '/catalog',
    search: { track: 'essay' as const },
    icon: PenLine,
  },
  {
    label: '按合集读',
    body: '一组一组顺着读，不按刊期，也不分高低。',
    to: '/issues',
    search: {},
    icon: Layers3,
  },
] as const

function displayTitle(resource: { short_title?: string | null; title: string }): string {
  return resource.short_title?.trim() || resource.title
}

function displayDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(d)
}

function Count({ value, ready }: { value: number | undefined; ready: boolean }) {
  return <span className="tabular-nums">{ready ? value ?? 0 : '…'}</span>
}

function HomePage() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const notice = useAnnouncementPortal()
  const [q, setQ] = useState('')
  const editorialQuery = useEditorialPicks(10)
  const stats = useCatalogStats('paper')
  const funStats = useCatalogStats('essay')
  const forumQ = useQuery({
    queryKey: ['home', 'forum-latest'],
    queryFn: async () =>
      (
        await api.get('/forum/topics', {
          params: { page: 1, page_size: 4, sort: 'latest' },
        })
      ).data,
  })

  const picks = editorialQuery.data?.data ?? []
  const featured = picks[0]
  const sidePicks = picks.slice(1, 4)
  const topics: HomeTopic[] = forumQ.data?.data ?? []
  const total = (stats.data?.total ?? 0) + (funStats.data?.total ?? 0)

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    const value = q.trim()
    void navigate({ to: '/catalog', search: value ? { q: value } : {} })
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {notice.announcement && (
        <AnnouncementDialog
          announcement={notice.announcement}
          open={notice.open}
          onOpenChange={notice.onOpenChange}
        />
      )}

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <BrandMark decorative className="h-7 w-7" />
            <span className="flex flex-col leading-none">
              <span className="font-serif text-base font-semibold tracking-tight">Rubbish</span>
              <span className="mt-1 hidden text-[9px] tracking-[0.18em] text-muted-foreground sm:block">
                公开写作与讨论
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-4 text-sm md:flex" aria-label="主导航">
            {[
              ['/', '首页'],
              ['/catalog', '内容'],
              ['/issues', '合集'],
              ['/forum', '讨论'],
              ['/guide', '怎么用'],
              ['/me', '我的'],
            ].map(([to, label]) => (
              <Link key={to} to={to} className="text-muted-foreground transition-colors hover:text-foreground">
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <form onSubmit={submitSearch} className="hidden lg:block">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜内容…"
                  aria-label="搜索内容"
                  className="h-9 w-44 rounded-full border bg-transparent pl-8 text-sm"
                />
              </div>
            </form>
            <span className="hidden sm:inline-flex">
              <AnnouncementChip
                announcement={notice.announcement}
                seen={notice.seen}
                onOpen={() => notice.setOpen(true)}
              />
            </span>
            <AppearanceMenu />
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link to="/submissions/new">
                <PenLine className="h-3.5 w-3.5" />
                发布
              </Link>
            </Button>
            {isAuthenticated ? (
              <Button asChild variant="ghost" size="sm">
                <Link to="/me">我的</Link>
              </Button>
            ) : (
              <Button asChild variant="ghost" size="sm">
                <Link to="/login">
                  <LogIn className="h-3.5 w-3.5" />
                  登录
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-border/70">
          <div className="mx-auto grid w-full max-w-[1280px] gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center">
            <div>
              <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-primary">
                <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-primary" />
                公开写作与讨论社区
              </p>
              <h1 className="mt-5 text-4xl leading-[1.15] tracking-tight sm:text-5xl" style={{ fontFamily: DISPLAY_FONT }}>
                把怪问题做完，
                <br />
                再讲给人听。
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-7 text-muted-foreground">
                读别人的过程记录，写自己的问题。短帖去讨论区，长文进内容库；
                不收费，注册就能发。
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="h-12 px-5">
                  <Link to="/catalog">
                    先读点什么
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 px-5">
                  <Link to="/submissions/new">
                    <PenLine className="h-4 w-4" />
                    写一篇
                  </Link>
                </Button>
                <Button asChild size="lg" variant="ghost" className="h-12 px-5 text-muted-foreground">
                  <Link to="/guide" search={{ tab: 'start' }}>
                    <Compass className="h-4 w-4" />
                    怎么用
                  </Link>
                </Button>
              </div>
              <p className="mt-7 text-xs text-muted-foreground">
                已公开 <Count value={total} ready={Boolean(stats.data || funStats.data)} /> 条内容 · 全部公开可读
              </p>
            </div>

            <Card className="border-primary/20 bg-primary/[0.025]">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.28em] text-primary">第一次来</p>
                    <h2 className="mt-1 font-serif text-2xl tracking-tight">从这里走一遍</h2>
                  </div>
                  <Badge variant="outline" className="border-primary/30 text-primary">约 3 分钟</Badge>
                </div>
                <div className="mt-4 divide-y">
                  {FIRST_STEPS.map(({ no, icon: Icon, title, body, to }) => (
                    <Link key={no} to={to} className="group flex gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="font-mono text-[11px] text-muted-foreground">{no}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-medium group-hover:text-primary">
                          <Icon className="h-3.5 w-3.5 text-primary/80" />
                          {title}
                          <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{body}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1280px] px-5 py-12 sm:px-8 sm:py-16">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b pb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-primary">Selected</p>
              <h2 className="mt-1 font-serif text-2xl tracking-tight sm:text-3xl">站内精选</h2>
            </div>
            <Link to="/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
              全部内容 <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          {editorialQuery.isLoading ? (
            <div className="grid gap-5 md:grid-cols-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 w-full" />)}
            </div>
          ) : featured ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
              <Link
                to="/catalog/$resourceId"
                params={{ resourceId: String(featured.id) }}
                className="group grid gap-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:items-center"
              >
                <ArticleCover
                  resource={featured}
                  aspect="aspect-[4/3]"
                  priority
                  showDiscipline={false}
                  className="transition-transform duration-500 group-hover:scale-[1.02]"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    <span className="text-primary">精选 #{featured.featured_rank ?? 1}</span>
                    <span aria-hidden>·</span>
                    <span>{featured.discipline || '跨领域'}</span>
                    <span aria-hidden>·</span>
                    <span>{displayDate(featured.created_at)}</span>
                  </div>
                  <h3 className="mt-3 font-serif text-2xl leading-snug tracking-tight group-hover:text-primary sm:text-3xl">
                    {displayTitle(featured)}
                  </h3>
                  {featured.editor_note ? (
                    <p className="mt-3 border-l-2 border-primary/40 pl-3 text-sm leading-6 text-muted-foreground">
                      {featured.editor_note}
                    </p>
                  ) : null}
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
                    {featured.abstract}
                  </p>
                  <p className="mt-4 text-xs text-foreground/70">{formatAuthors(featured.authors, 3)}</p>
                </div>
              </Link>

              <div className="divide-y border-t lg:border-l lg:border-t-0 lg:pl-6">
                {sidePicks.length > 0 ? sidePicks.map((item) => (
                  <Link
                    key={item.id}
                    to="/catalog/$resourceId"
                    params={{ resourceId: String(item.id) }}
                    className="group flex gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <ArticleCover
                      resource={item}
                      aspect="aspect-square"
                      showDiscipline={false}
                      className="w-16 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-5 group-hover:text-primary">
                        {displayTitle(item)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.discipline || '跨领域'} · {item.editor_note || '站内精选'}
                      </span>
                    </span>
                  </Link>
                )) : (
                  <p className="py-4 text-sm text-muted-foreground">精选正在更新，先去内容库随便翻。</p>
                )}
              </div>
            </div>
          ) : (
            <div className="border-y py-8 text-sm text-muted-foreground">
              精选正在整理。
              <Link to="/catalog" className="ml-2 text-primary hover:underline">直接去内容库</Link>
            </div>
          )}
        </section>

        <section className="border-y border-border/70 bg-muted/20">
          <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div>
              <div className="mb-4 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.28em] text-primary">Talk</p>
                  <h2 className="mt-1 font-serif text-2xl tracking-tight">讨论区正在聊</h2>
                </div>
                <Link to="/forum" className="text-sm text-muted-foreground hover:text-primary">去讨论区 →</Link>
              </div>
              {forumQ.isLoading ? (
                <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : topics.length > 0 ? (
                <div className="divide-y border-y bg-background/60">
                  {topics.map((topic) => (
                    <Link
                      key={topic.id}
                      to="/forum/$topicId"
                      params={{ topicId: String(topic.id) }}
                      className="group flex items-start justify-between gap-4 px-3 py-3.5 hover:bg-background"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-5 group-hover:text-primary">{topic.title}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {topic.board_name || '讨论'} · {topic.author?.display_name || topic.author?.username || '匿名'} · {displayDate(topic.last_reply_at || topic.created_at)}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{topic.reply_count} 回复</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="border-y py-8 text-sm text-muted-foreground">
                  还没人开帖。你可以发第一个问题。
                  <Link to="/forum" search={{ compose: 1 }} className="ml-2 text-primary hover:underline">去发帖</Link>
                </p>
              )}
            </div>

            <div>
              <div className="mb-4">
                <p className="text-[10px] uppercase tracking-[0.28em] text-primary">Browse</p>
                <h2 className="mt-1 font-serif text-2xl tracking-tight">按你想看的方式找</h2>
              </div>
              <div className="divide-y border-y bg-background/60">
                {CONTENT_KINDS.map(({ label, body, to, search, icon: Icon }) => (
                  <Link
                    key={label}
                    to={to}
                    search={search}
                    className="group flex items-center gap-3 px-3 py-4 hover:bg-background"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium group-hover:text-primary">{label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1280px] px-5 py-12 sm:px-8 sm:py-16">
          <div className="mb-6">
            <p className="text-[10px] uppercase tracking-[0.28em] text-primary">How it works</p>
            <h2 className="mt-1 font-serif text-2xl tracking-tight">不知道怎么用，从这里开始</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['3 分钟上手', '全站地图、四步走和旧名字对照。', '/guide', 'start'],
              ['写内容', '定题、结构、材料、发布前检查。', '/guide', 'authors'],
              ['规则与边界', '版权、隐私、虚构标注与处理流程。', '/guide', 'policies'],
            ].map(([title, body, to, tab]) => (
              <Link key={title} to={to} search={{ tab }} className="group border-t pt-4">
                <p className="flex items-center gap-2 text-sm font-medium group-hover:text-primary">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  {title}
                  <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70 bg-background">
        <div className="mx-auto grid w-full max-w-[1280px] gap-8 px-5 py-9 text-sm sm:px-8 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-center gap-2.5">
              <BrandMark decorative className="h-7 w-7" />
              <span className="font-serif text-xl font-semibold">Rubbish</span>
            </div>
            <p className="mt-2 max-w-md text-xs leading-6 text-muted-foreground">
              Rubbish 是公开写作与讨论社区，不是期刊、出版社或学术评价机构；不提供 DOI、ISSN、
              职称认定、学分或学历背书。站内编号只用于站内定位。
            </p>
          </div>
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">去逛</p>
            <ul className="space-y-1.5">
              <li><Link to="/catalog" className="hover:text-primary">内容库</Link></li>
              <li><Link to="/issues" className="hover:text-primary">合集</Link></li>
              <li><Link to="/forum" className="hover:text-primary">讨论区</Link></li>
              <li><Link to="/guide" search={{ tab: 'start' }} className="hover:text-primary">怎么用</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">规则与联系</p>
            <ul className="space-y-1.5">
              <li><Link to="/guide" search={{ tab: 'policies' }} className="hover:text-primary">规则与边界</Link></li>
              <li><Link to="/privacy" className="hover:text-primary">隐私政策</Link></li>
              <li><Link to="/about" className="hover:text-primary">关于站点</Link></li>
              <li>
                <a href="mailto:info@rubbishasci.cn" className="break-all hover:text-primary">
                  info@rubbishasci.cn
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/70">
          <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs text-muted-foreground sm:px-8">
            <span>© {new Date().getFullYear()} Rubbish · 公开写作与讨论</span>
            <span>认真做，大胆荒诞，公开聊。</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
