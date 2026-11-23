import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, Gauge, ShieldCheck, Sparkles } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useMe } from '@/hooks/api/use-auth'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RoleApplicationPanel } from '@/components/levels/role-application-panel'
import { ACTIVITY_BANDS, levelForXp, nextBand } from '@/lib/activity-levels'

export const Route = createFileRoute('/levels')({
  component: LevelsPage,
})

const IDENTITY_ROWS = [
  {
    label: '站点管理组',
    who: '总协调 / 站务组',
    body: '管站点设置、审计、权限分配与侵权申诉，也参与内容整理。',
  },
  {
    label: '内容工作组',
    who: '内容整理 / 互评成员 / 资深互评成员',
    body: '做基础整理、互评和内容核对；不碰站点设置、审计与权限分配。',
  },
  {
    label: '成员组',
    who: '作者 / 成员',
    body: '能读、能说话、能回应、能写一篇；所有公开内容都开放阅读。',
  },
]

const XP_SOURCES = [
    '注册、补全资料、确认写作规范',
    '说话、回应、每日签到',
    '发布作品、作品公开、参与互评',
    '内容整理与社区治理',
]

function LevelsPage() {
  const { isAuthenticated } = useAuth()
  const me = useMe(isAuthenticated)
  const xp = me.data?.xp ?? 0
  const currentLevel = levelForXp(xp)
  const currentBand = ACTIVITY_BANDS.find((band) => band.level === currentLevel) ?? ACTIVITY_BANDS[0]
  const next = nextBand(currentLevel)
  const toNext = next ? Math.max(0, next.floor - xp) : 0
  const progress = next
    ? Math.max(0, Math.min(1, (xp - currentBand.floor) / Math.max(1, next.floor - currentBand.floor)))
    : 1

  return (
    <div className="mx-auto max-w-4xl space-y-7">
      <PageHeader
        title="参与记录"
        description="这里记的是脚印，不是头衔。说话、回应、写一篇、参与互评、签到，都会留下经验。它不换权限；所有人从第一档开始。"
      />

      {isAuthenticated ? (
        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardContent className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap sm:p-5">
            <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center border border-primary/30 bg-background">
              <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">档位</span>
              <span className="font-mono text-2xl font-semibold leading-none text-primary">{currentLevel}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-serif text-lg font-semibold">你在这里走了多远</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {xp} 经验{next ? ` · 离下一档还差 ${toNext}` : ' · 已到最高档'}
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{
                    width: `${Math.round(progress * 100)}%`,
                  }}
                />
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link to="/me">
                我的空间
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm text-muted-foreground sm:p-5">
            <span>登录后，能看见自己的经验与档位，以及离下一档还有多远。</span>
            <Button asChild size="sm">
              <Link to="/login" search={{ redirect: '/levels' }}>登录查看</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {isAuthenticated ? <RoleApplicationPanel /> : null}

      <section className="grid gap-4 border-y py-6 sm:grid-cols-2">
        <div className="border-l-2 border-primary pl-4">
          <p className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" />
            身份决定“能做什么”
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            角色一层层往下继承：站点管理组有内容工作组的全部能力，内容工作组有成员组的能力。
          </p>
        </div>
        <div className="border-l-2 border-border pl-4">
          <p className="flex items-center gap-2 font-medium">
            <Gauge className="h-4 w-4 text-primary" />
            经验，只说明你走了多远
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            档位 1 到 10 由经验推进，所有人同一条起跑线。经验高，不会自动拿到互评或管理权限；低，也不会被挡在阅读和说话之外。
          </p>
        </div>
      </section>

      <section>
        <h2 className="font-serif text-xl font-semibold">参与记录</h2>
        <p className="mt-1 text-sm text-muted-foreground">每一档只看累计经验，不看身份。</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {ACTIVITY_BANDS.map((band) => {
            const active = band.level === currentLevel && isAuthenticated
            return (
              <div
                key={band.level}
                className={[
                  'border px-3 py-3 text-center',
                  active ? 'border-primary bg-primary/5' : 'bg-card',
                ].join(' ')}
              >
                <p className="font-mono text-lg font-semibold">{band.level}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {band.floor === 0 ? '起步' : `${band.floor}+`}
                </p>
                {active ? (
                  <Badge variant="outline" className="mt-1 border-primary/30 text-[9px] text-primary">
                    当前
                  </Badge>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="flex items-center gap-2 font-serif text-xl font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          经验从哪里来
        </h2>
        <div className="mt-3 grid gap-2 border-y py-4 sm:grid-cols-2">
          {XP_SOURCES.map((source) => (
            <p key={source} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
              {source}
            </p>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-serif text-xl font-semibold">身份与权限</h2>
        <p className="mt-1 text-sm text-muted-foreground">上一层有下一层的全部权限；档位不在这张表里。</p>
        <div className="mt-4 space-y-2">
          {IDENTITY_ROWS.map((row, index) => (
            <div
              key={row.label}
              className="grid gap-2 border bg-card p-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:items-start"
              style={{ marginLeft: `${index * 12}px` }}
            >
              <p className="font-medium">{row.label}</p>
              <div>
                <p className="text-xs text-muted-foreground">{row.who}</p>
                <p className="mt-1 text-sm leading-6">{row.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

    </div>
  )
}
