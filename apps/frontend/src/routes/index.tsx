import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowRight,
  ChevronRight,
  LogIn,
  PenLine,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'
import { useEditorialPicks, useResources } from '@/hooks/api/use-modules'
import { formatAuthors } from '@/lib/utils'
import { readAccessRegion } from '@/lib/access'
import { navLabel, useLang } from '@/lib/i18n'
import { AnnouncementChip, AnnouncementDialog, useAnnouncementPortal } from '@/components/common/announcement-dialog'
import { AppearanceMenu } from '@/components/appearance-menu'
import { LanguageButton } from '@/components/language-button'
import { ArticleCover } from '@/components/common/article-cover'
import { BrandMark } from '@/components/common/brand-mark'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/')({
  component: HomePage,
})

interface HomeTopic {
  id: number
  title: string
  board_name: string | null
  reply_count: number
  last_reply_at: string | null
  created_at: string
  author: { display_name?: string | null; username: string } | null
}

const PRIMARY_NAV = [
  ['/', '首页'],
  ['/catalog', '内容库'],
  ['/issues', '卷'],
  ['/forum', '主题论坛'],
  ['/guide', '怎么用'],
  ['/me', '我的'],
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

const SITE_QQ_GROUP = '1084870548'

function GuestCover() {
  const overseas = readAccessRegion() === 'overseas'
  const lang = useLang()
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5 py-16">
      <div className="absolute right-3 top-3 z-20">
        <LanguageButton />
      </div>
      <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden>
        <div className="absolute -left-24 top-16 h-56 w-56 rounded-full border border-border/60" />
        <div className="absolute -right-20 bottom-10 h-64 w-64 rounded-full border border-dashed border-border/70" />
      </div>

      <main className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        <Link to="/" aria-label="Rubbish 首页" className="transition-opacity hover:opacity-80">
          <BrandMark decorative className="h-24 w-24 sm:h-28 sm:w-28" />
        </Link>
        <p className="mt-7 text-[10px] uppercase tracking-[0.34em] text-primary">
          Rubbish
        </p>
        <h1
          className={
            lang === 'en'
              ? 'mt-3 font-serif text-[1.5rem] leading-[1.2] tracking-tight sm:text-[2.15rem]'
              : 'mt-3 font-serif text-4xl leading-none tracking-tight sm:text-5xl'
          }
        >
          {overseas ? (
            lang === 'en' ? (
              <>
                <span className="block">Writing and the Forum</span>
                <span className="block">Open to readers</span>
                <span className="block">outside mainland China</span>
              </>
            ) : (
              <>
                <span className="block">文章与主题论坛</span>
                <span className="block">对境外读者开放</span>
              </>
            )
          ) : (
            lang === 'en' ? 'Members only' : '仅对注册用户开放'
          )}
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          {overseas
            ? '无需注册即可阅读文章和主题论坛；写作、回复与账号功能需要邀请注册。'
            : '登录后可以阅读、写作，并参与站内讨论。'}
        </p>

        {overseas ? (
          <div className="mt-7 grid w-full gap-3 sm:grid-cols-2">
            <Button asChild size="lg" className="h-11 w-full px-6">
              <Link to="/catalog">
                读文章
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 w-full px-6">
              <Link to="/forum">
                逛主题论坛
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        ) : null}

        <div className="mt-7 flex w-full flex-wrap items-center justify-center gap-3">
          <Button asChild size={overseas ? 'default' : 'lg'} variant={overseas ? 'ghost' : 'default'} className={overseas ? 'h-9 px-4' : 'h-11 min-w-32 px-6'}>
            <Link to="/login">
              <LogIn className="h-4 w-4" />
              登录
            </Link>
          </Button>
          <Button asChild size={overseas ? 'default' : 'lg'} variant="outline" className={overseas ? 'h-9 px-4' : 'h-11 min-w-32 px-6'}>
            <Link to="/register">
              注册
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-10 w-full border-t border-border/70 pt-6">
          <p className="text-xs leading-6 text-muted-foreground">
            没有账号，或访问不了？加入读者群完成认证。
          </p>
          <p className="mt-2 font-mono text-lg font-semibold tracking-[0.08em] text-foreground">
            QQ 群 {SITE_QQ_GROUP}
          </p>
        </div>
      </main>
    </div>
  )
}

function HomePage() {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <GuestCover />
  return <MemberHome />
}

function MemberHome() {
  const lang = useLang()
  const notice = useAnnouncementPortal()
  const editorialQuery = useEditorialPicks(4)
  const latestQ = useResources({ page: 1, page_size: 6, sort: 'created_at', order: 'desc' })
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
  const latest = (latestQ.data?.data ?? [])
    .filter((item) => !picks.some((pick) => pick.id === item.id))
    .slice(0, 3)
  const topics: HomeTopic[] = forumQ.data?.data ?? []

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
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-3 px-5 py-3 sm:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <BrandMark decorative className="h-6 w-6" />
            <span className="flex flex-col leading-none">
              <span className="font-serif text-base font-semibold tracking-tight">Rubbish</span>
              <span className="mt-0.5 hidden text-[9px] tracking-[0.18em] text-muted-foreground sm:block">
                公开写作与讨论
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-3 text-sm md:flex" aria-label="主导航">
            {PRIMARY_NAV.map(([to, label]) => (
              <Link key={to} to={to} className="text-muted-foreground transition-colors hover:text-foreground">
                {navLabel(to, label, lang)}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <span className="hidden sm:inline-flex">
              <AnnouncementChip
                announcement={notice.announcement}
                seen={notice.seen}
                onOpen={() => notice.setOpen(true)}
              />
            </span>
            <LanguageButton />
            <AppearanceMenu />
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <Link to="/submissions/new">
                <PenLine className="h-3.5 w-3.5" />
                写一篇
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative flex min-h-[calc(100svh-3.75rem)] items-center justify-center overflow-hidden border-b border-border/70 px-5 py-14 text-center sm:px-8">
          <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden>
            <div className="absolute -left-24 top-16 h-56 w-56 rounded-full border border-border/60" />
            <div className="absolute -right-20 bottom-10 h-64 w-64 rounded-full border border-dashed border-border/70" />
          </div>

          <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center">
            <BrandMark decorative className="h-20 w-20 sm:h-24 sm:w-24" />
            <p className="mt-6 text-[10px] uppercase tracking-[0.34em] text-primary">
              公开写作与讨论社区
            </p>
            <h1 className="mt-4 font-serif text-4xl leading-none tracking-tight sm:text-6xl">
              Rubbish
            </h1>
            <p className="mt-5 max-w-xl font-serif text-xl leading-snug tracking-tight text-foreground sm:text-2xl">
              长文在内容库，半句话在主题论坛。
            </p>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-7 text-muted-foreground">
              读别人的路，也写自己的停顿。登录后可以阅读、写作，也能在主题论坛说一句。
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="h-11 px-5">
                <Link to="/catalog">
                  先读一篇
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-5">
                <Link to="/submissions/new">
                  <PenLine className="h-4 w-4" />
                  我也写一篇
                </Link>
              </Button>
            </div>

            <div className="mt-12 flex flex-col items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              <span>往下读</span>
              <ArrowDown className="h-4 w-4 animate-bounce" />
            </div>
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-[1280px] flex-col justify-center px-5 py-10 sm:min-h-[calc(100svh-3.75rem)] sm:px-8 sm:py-14">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b pb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-primary">精选</p>
              <h2 className="mt-1 font-serif text-2xl tracking-tight">先读这些</h2>
            </div>
            <Link to="/catalog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
              去内容库 <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          {editorialQuery.isLoading ? (
            <div className="grid gap-5 md:grid-cols-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-full" />)}
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
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    <span>{featured.discipline || '跨领域'}</span>
                    <span aria-hidden>·</span>
                    <span>{displayDate(featured.created_at)}</span>
                  </div>
                  <h3 className="mt-3 font-serif text-2xl leading-snug tracking-tight group-hover:text-primary">
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
              <Link to="/catalog" className="ml-2 text-primary underline underline-offset-2 hover:underline">直接去内容库</Link>
            </div>
          )}

          {latest.length > 0 ? (
            <div className="mt-9 border-t pt-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.28em] text-primary">最近</p>
                  <h3 className="mt-1 font-serif text-lg tracking-tight">刚摆上桌</h3>
                </div>
                <Link to="/catalog" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                  全部文字 <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {latest.map((item) => (
                  <Link
                    key={item.id}
                    to="/catalog/$resourceId"
                    params={{ resourceId: String(item.id) }}
                    className="group flex items-center gap-3 rounded-lg border bg-background/70 p-3 transition-colors hover:border-primary/40"
                  >
                    <ArticleCover
                      resource={item}
                      aspect="aspect-[4/3]"
                      showDiscipline={false}
                      className="w-24 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="line-clamp-2 block text-sm font-medium leading-5 group-hover:text-primary">
                        {displayTitle(item)}
                      </span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {item.discipline || '跨领域'} · {displayDate(item.created_at)}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="border-t border-border/70 bg-muted/20 sm:flex sm:min-h-[calc(100svh-3.75rem)] sm:items-center">
          <div className="mx-auto w-full max-w-[1280px] px-5 py-10 sm:px-8 sm:py-14">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.28em] text-primary">主题论坛</p>
                <h2 className="mt-1 font-serif text-2xl tracking-tight">正在发生的讨论</h2>
              </div>
              <Link to="/forum" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
                去主题论坛 <ChevronRight className="h-4 w-4" />
              </Link>
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
                主题论坛还空着。你可以发第一个主题帖。
                <Link to="/forum" search={{ compose: 1 }} className="ml-2 text-primary underline underline-offset-2 hover:underline">去说一句</Link>
              </p>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-background/70 p-4">
                <p className="text-[10px] uppercase tracking-[0.28em] text-primary">本周写什么</p>
                <p className="mt-2 font-serif text-lg leading-snug">你最近一次推翻重写，是因为什么？</p>
                <Link
                  to="/forum"
                  search={{ compose: 1 }}
                  className="mt-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
                >
                  去回应 <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="rounded-lg border border-dashed bg-background/40 p-4">
                <p className="text-[10px] uppercase tracking-[0.28em] text-primary">只想说一句</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  短帖留在主题论坛，长文去发布作品。登录就能说话，不必先攒经验。
                </p>
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <Link to="/forum" search={{ compose: 1 }} className="text-primary underline underline-offset-2 hover:underline">去说话</Link>
                  <Link to="/submissions/new" className="text-muted-foreground hover:text-primary">写长文</Link>
                </div>
              </div>
            </div>
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
              Rubbish 是一张公开的桌面：可读，可写，可聊。它不做学术评价，也不出具职称、学分、学历或公开证明；站内编号只用于定位。
            </p>
          </div>
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">走走</p>
            <ul className="space-y-1.5">
              <li><Link to="/catalog" className="hover:text-primary">内容库</Link></li>
              <li><Link to="/issues" className="hover:text-primary">卷</Link></li>
              <li><Link to="/forum" className="hover:text-primary">主题论坛</Link></li>
              <li><Link to="/search" className="hover:text-primary">站内搜索</Link></li>
              <li><Link to="/tags" className="hover:text-primary">标签与归档</Link></li>
              <li><Link to="/guide" search={{ tab: 'start' }} className="hover:text-primary">怎么用</Link></li>
            </ul>
          </div>
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">规则与联系</p>
            <ul className="space-y-1.5">
              <li><Link to="/guide" search={{ tab: 'policies' }} className="hover:text-primary">边界与处理</Link></li>
              <li><Link to="/privacy" className="hover:text-primary">隐私政策</Link></li>
              <li><Link to="/status" className="hover:text-primary">站点状态</Link></li>
              <li><Link to="/accessibility" className="hover:text-primary">可访问性说明</Link></li>
              <li><Link to="/about" className="hover:text-primary">关于此处</Link></li>
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
            <span>认真写。允许荒诞。把话留在公开处。</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
