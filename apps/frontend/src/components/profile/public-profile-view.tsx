import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Award,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Globe2,
  Mail,
  MapPin,
  MessageSquare,
  MessageSquareText,
  Share2,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDisciplines } from '@/hooks/api/use-modules'
import type { PublicProfile } from '@/hooks/api/use-profile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { typeLabel } from '@/lib/resource-labels'

function fmtDate(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

const TOPIC_CATEGORY_LABELS: Record<string, string> = {
  discussion: '写作讨论',
  records: '记录与复盘',
  collab: '组队招募',
  admissions: '招生与导师',
  'admissions-recruit': '导师招生',
  'admissions-seek': '学生找导师',
  life: '创作生活',
  site: '站务与反馈',
  research: '记录与复盘',
  planning: '记录与复盘',
  'lab-notes': '记录与复盘',
  'field-notes': '记录与复盘',
  'failures': '记录与复盘',
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

const STAT_ITEMS = [
  { key: 'works', label: '作品', icon: BookOpen },
  { key: 'forum_topics', label: '主题帖', icon: MessageSquareText },
  { key: 'forum_replies', label: '回应', icon: MessageSquare },
  { key: 'followers', label: '关注者', icon: Users },
  { key: 'following', label: '关注', icon: UserPlus },
] as const

const TABS = ['works', 'topics', 'about'] as const
type ProfileTab = (typeof TABS)[number]

export function PublicProfileView({
  profile,
  actions,
  footer,
}: {
  profile: PublicProfile
  actions?: ReactNode
  footer?: ReactNode
}) {
  const user = profile.user
  const accent = user.accent_color || '#2f5d46'
  const name = user.display_name || user.username
  const handleDiffers = name.toLocaleLowerCase() !== user.username.toLocaleLowerCase()
  const [bannerFailed, setBannerFailed] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [tab, setTab] = useState<ProfileTab>('works')
  const [shared, setShared] = useState(false)
  const lastSpokeAt = profile.topics[0]?.created_at ?? null
  const disciplines = useDisciplines()
  const disciplineNames = new Map((disciplines.data ?? []).map((item) => [item.slug, item.name]))
  const subjectAreas = (user.subject_disciplines ?? []).map((slug) => ({
    slug,
    name: disciplineNames.get(slug) ?? slug,
  }))
  const links = [
    user.website ? { href: user.website, label: '个人网站', icon: Globe2 } : null,
    user.google_scholar
      ? { href: user.google_scholar, label: 'Google Scholar', icon: BookOpen }
      : null,
    user.orcid ? { href: user.orcid, label: 'ORCID', icon: Award } : null,
    user.contact_email
      ? { href: `mailto:${user.contact_email}`, label: user.contact_email, icon: Mail }
      : null,
  ].filter(Boolean) as Array<{ href: string; label: string; icon: typeof Globe2 }>

  const shareProfile = async () => {
    const url = window.location.href.split('?')[0]
    try {
      if (navigator.share) {
        await navigator.share({ title: `${name} 的主页`, url })
        return
      }
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(url)
      setShared(true)
      toast.success('主页链接已复制')
      window.setTimeout(() => setShared(false), 1600)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.error('复制失败，请手动复制地址栏链接')
    }
  }

  const tabCounts: Record<ProfileTab, number> = {
    works: profile.stats.works,
    topics: profile.stats.forum_topics,
    about: profile.stats.badges,
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <Card className="overflow-hidden">
        <div className="relative h-20 sm:h-40" style={{ backgroundColor: `${accent}18` }}>
          {user.banner_url && !bannerFailed ? (
            <img
              src={user.banner_url}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setBannerFailed(true)}
            />
          ) : (
            <div
              className="h-full w-full"
              style={{
                background: `radial-gradient(circle at 18% 20%, ${accent}55 0, transparent 38%), linear-gradient(120deg, ${accent}22, ${accent}55)`,
              }}
            />
          )}
          <div className="absolute right-3 top-3 flex flex-wrap items-center justify-end gap-2 sm:right-5 sm:top-5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void shareProfile()}
              className="border-border/70 bg-background/85 shadow-sm backdrop-blur"
            >
              {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
              <span>{shared ? '已复制' : '分享主页'}</span>
            </Button>
            {actions}
          </div>
        </div>

        <CardContent className="relative px-4 pb-3 sm:px-6 sm:pb-5">
          <div className="flex items-start gap-3 sm:gap-4">
            {user.avatar_url && !avatarFailed ? (
              <img
                src={user.avatar_url}
                alt=""
                className="-mt-8 h-16 w-16 shrink-0 rounded-full border-4 border-card object-cover shadow-sm sm:-mt-10 sm:h-20 sm:w-20"
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span
                className="-mt-8 flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-card text-xl font-semibold text-white shadow-sm sm:-mt-10 sm:h-20 sm:w-20 sm:text-2xl"
                style={{ backgroundColor: accent }}
              >
                {name.slice(0, 1)}
              </span>
            )}
            <div className="min-w-0 flex-1 pb-0.5 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight sm:text-2xl">
                  {name}
                </h1>
                {profile.is_owner ? <Badge variant="outline">我的主页</Badge> : null}
              </div>
              {handleDiffers ? (
                <p className="mt-0.5 text-xs text-muted-foreground">@{user.username}</p>
              ) : null}
              {user.bio ? (
                <p className="mt-1.5 line-clamp-3 max-w-2xl text-[13px] leading-5 text-muted-foreground sm:text-sm sm:leading-6">
                  {user.bio}
                </p>
              ) : (
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  {profile.is_owner ? (
                    <>
                      还没有写简介。
                      <Link
                        to="/me"
                        search={{ tab: 'settings', section: 'profile' }}
                        className="ml-1 text-primary hover:underline"
                      >
                        去资料页补一句
                      </Link>
                      ，别人会更知道你。
                    </>
                  ) : (
                    '还没有写简介。'
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:mt-4 sm:text-sm">
            {(user.affiliation || user.department || user.academic_title) && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                {[user.affiliation, user.department, user.academic_title].filter(Boolean).join(' · ')}
              </span>
            )}
            {user.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {user.location}
              </span>
            )}
            {user.created_at && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                加入于 {fmtDate(user.created_at)}
              </span>
            )}
            {lastSpokeAt && (
              <span className="inline-flex items-center gap-1.5">
                <MessageSquareText className="h-3.5 w-3.5" />
                最近发言 {fmtDate(lastSpokeAt)}
              </span>
            )}
          </div>

          {links.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5 sm:mt-3 sm:gap-2">
              {links.map((link) => {
                const Icon = link.icon
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target={link.href.startsWith('mailto:') ? undefined : '_blank'}
                    rel="noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary sm:px-3 sm:py-1.5 sm:text-xs"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 whitespace-normal break-all text-left">{link.label}</span>
                  </a>
                )
              })}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y py-2.5 sm:mt-4 sm:gap-x-5 sm:gap-y-2 sm:py-3">
            {STAT_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <div
                  key={item.key}
                  className={cn(
                    'items-baseline gap-1.5',
                    item.key === 'forum_replies' ? 'hidden sm:inline-flex' : 'inline-flex',
                  )}
                >
                  <Icon className="translate-y-0.5 h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-lg font-semibold tabular-nums leading-none sm:text-xl">
                    {profile.stats[item.key]}
                  </span>
                  <span className="text-[11px] text-muted-foreground sm:text-xs">{item.label}</span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {footer}

      <div>
        <nav aria-label="主页内容分类" className="flex items-center gap-1 overflow-x-auto border-b">
          {TABS.map((key) => {
            const label = key === 'works' ? '作品' : key === 'topics' ? '主题帖' : '关于'
            const active = tab === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                className={cn(
                  'relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-sm transition-colors',
                  active ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
                {key !== 'about' ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">{tabCounts[key]}</span>
                ) : null}
                {active ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" /> : null}
              </button>
            )
          })}
        </nav>

        <div className="pt-4">
          {tab === 'works' ? (
            <Card>
              <CardContent className="pt-4 sm:pt-5">
                {profile.works.length === 0 ? (
                  <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-9 text-center">
                    <BookOpen className="mx-auto h-5 w-5 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">还没有公开作品</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {profile.is_owner
                        ? '发布之后，作品会按时间排在这里。'
                        : '等作者发布之后，会出现在这里。'}
                    </p>
                    {profile.is_owner ? (
                      <Button size="sm" className="mt-3" asChild>
                        <Link to="/submissions/new">去写第一篇</Link>
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {profile.works.map((work) => (
                      <Link
                        key={work.id}
                        to="/catalog/$resourceId"
                        params={{ resourceId: String(work.id) }}
                        className="group flex gap-3 rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-muted/20"
                      >
                        {work.cover_image ? (
                          <img
                            src={work.cover_image}
                            alt=""
                            width={56}
                            height={72}
                            loading="lazy"
                            decoding="async"
                            className="h-[72px] w-14 shrink-0 rounded-md object-cover"
                          />
                        ) : (
                          <span className="flex h-[72px] w-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <BookOpen className="h-4 w-4" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm font-medium leading-5 group-hover:text-primary">
                            {work.title}
                          </span>
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            {typeLabel(work.type)} · {work.discipline}
                          </span>
                          <span className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>{work.published_at ? fmtDate(work.published_at) : '未排期'}</span>
                            <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                          </span>
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {tab === 'topics' ? (
            <Card>
              <CardContent className="pt-4 sm:pt-5">
                {profile.topics.length === 0 ? (
                  <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-9 text-center">
                    <MessageSquareText className="mx-auto h-5 w-5 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">还没有在主题论坛留下句子</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {profile.is_owner ? '一个问题、一条复盘，都算开始。' : '等作者开口之后，会出现在这里。'}
                    </p>
                    {profile.is_owner ? (
                      <Button size="sm" className="mt-3" asChild>
                        <Link to="/forum">去主题论坛</Link>
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <ul className="divide-y">
                    {profile.topics.map((topic) => (
                      <li key={topic.id}>
                        <Link
                          to="/forum/$topicId"
                          params={{ topicId: String(topic.id) }}
                          className="group flex items-start gap-3 py-3 first:pt-0 last:pb-0"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block line-clamp-2 text-sm font-medium leading-6 group-hover:text-primary">
                              {topic.title}
                            </span>
                            {topic.excerpt ? (
                              <span className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                                {topic.excerpt}
                              </span>
                            ) : null}
                            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              <span>{TOPIC_CATEGORY_LABELS[topic.category] ?? topic.category}</span>
                              <span aria-hidden>·</span>
                              <span>{topic.reply_count} 回应</span>
                              <span aria-hidden>·</span>
                              <span>{fmtDate(topic.last_activity_at ?? topic.created_at)}</span>
                            </span>
                          </span>
                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ) : null}

          {tab === 'about' ? (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Card>
                <CardContent className="space-y-4 pt-5 text-sm">
                  {subjectAreas.length > 0 ? (
                    <div className="border-b pb-4">
                      <h2 className="text-sm font-semibold">科目领域</h2>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {subjectAreas.map((area) => (
                          <Link
                            key={area.slug}
                            to="/fields/$slug"
                            params={{ slug: area.slug }}
                            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={`进入「${area.name}」领域页`}
                          >
                            <Badge
                              variant="secondary"
                              className="cursor-pointer text-[11px] font-normal transition-colors hover:bg-primary/10 hover:text-primary"
                            >
                              {area.name}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                      <Link
                        to="/search"
                        search={{ type: 'people', discipline: subjectAreas[0]?.slug }}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                      >
                        看看同领域的人 <ChevronRight className="h-3 w-3" />
                      </Link>
                    </div>
                  ) : profile.is_owner ? (
                    <div className="border-b pb-4">
                      <h2 className="text-sm font-semibold">科目领域</h2>
                      <p className="mt-1.5 text-muted-foreground">
                        还没有选科目领域。
                        <Link
                          to="/me"
                          search={{ tab: 'settings', section: 'profile' }}
                          className="ml-1 text-primary hover:underline"
                        >
                          去资料页补上
                        </Link>
                        。
                      </p>
                    </div>
                  ) : null}
                  <div>
                    <h2 className="text-sm font-semibold">关注方向</h2>
                    {user.research_interests ? (
                      <p className="mt-1.5 leading-7 text-muted-foreground">{user.research_interests}</p>
                    ) : (
                      <p className="mt-1.5 text-muted-foreground">
                        {profile.is_owner ? (
                          <>
                            还没有留下关注方向。
                            <Link
                              to="/me"
                              search={{ tab: 'settings', section: 'profile' }}
                              className="ml-1 text-primary hover:underline"
                            >
                              去资料页补上
                            </Link>
                            。
                          </>
                        ) : (
                          '还没有留下关注方向。'
                        )}
                      </p>
                    )}
                  </div>
                  {(user.affiliation || user.department || user.academic_title) && (
                    <div className="border-t pt-4">
                      <h2 className="text-sm font-semibold">机构</h2>
                      <p className="mt-1.5 text-muted-foreground">
                        {[user.affiliation, user.department, user.academic_title].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  )}
                  {user.location ? (
                    <div className="border-t pt-4">
                      <h2 className="text-sm font-semibold">所在地</h2>
                      <p className="mt-1.5 text-muted-foreground">{user.location}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Award className="h-4 w-4 text-primary" /> 徽章
                    <Badge variant="secondary">{profile.badges.length}</Badge>
                  </h2>
                  {profile.badges.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">还没有获得徽章。</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {profile.badges.map((badge) => (
                        <li
                          key={badge.key}
                          className={cn(
                            'flex items-start gap-2 rounded-lg border px-2.5 py-2',
                            badge.tier === 'gold'
                              ? 'border-amber-300/70 bg-amber-50/70 text-amber-900'
                              : badge.tier === 'silver'
                                ? 'border-slate-300/70 bg-slate-50/80 text-slate-700'
                                : 'border-emerald-200/70 bg-emerald-50/60 text-emerald-900',
                          )}
                        >
                          <Award className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-xs font-medium">{badge.name}</span>
                            <span className="mt-0.5 block text-[10px] leading-4 opacity-80">{badge.description}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
