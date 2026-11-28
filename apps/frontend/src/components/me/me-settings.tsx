import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ExternalLink, Settings2 } from 'lucide-react'
import { useMe, useResendVerification } from '@/hooks/api/use-auth'
import { ProfileDetailsCard } from '@/components/settings/profile-details-card'
import { ProfileAreasCard } from '@/components/settings/profile-areas-card'
import { NotificationPrefsCard } from '@/components/settings/notification-prefs-card'
import { TwoFactorSection } from '@/components/settings/two-factor-section'
import { ChangePasswordCard } from '@/components/settings/change-password-card'
import { AccountDataCard } from '@/components/settings/account-data-card'
import { AiAccessCard } from '@/components/settings/ai-access-card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const SUB_TABS = [
  { key: 'profile', label: '资料' },
  { key: 'security', label: '安全' },
  { key: 'notifications', label: '通知' },
  { key: 'ai', label: 'AI 接入' },
] as const

type SettingsSubTab = (typeof SUB_TABS)[number]['key']

export function MeSettings({ username, initialSection }: { username: string; initialSection?: string }) {
  const resolvedInitial = SUB_TABS.find((item) => item.key === initialSection)?.key ?? 'profile'
  const [tab, setTab] = useState<SettingsSubTab>(resolvedInitial)
  const { data: me } = useMe()
  const resend = useResendVerification()

  useEffect(() => {
    setTab(resolvedInitial)
  }, [resolvedInitial])

  return (
    <section>
      <div className="flex items-start justify-between gap-3 border-b pb-3">
        <div className="min-w-0">
          <h2 className="font-serif text-lg tracking-tight">账号设置</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            资料、安全、通知与 AI 接入；留空不会覆盖已有内容。
          </p>
        </div>
        <Button variant="ghost" size="sm" asChild className="shrink-0">
          <Link to="/u/$username" params={{ username }}>
            <ExternalLink className="h-3.5 w-3.5" />
            公开主页
          </Link>
        </Button>
      </div>

      <nav aria-label="设置分类" className="mt-3 flex flex-wrap gap-1 border-b">
        {SUB_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            data-active={tab === item.key ? 'true' : 'false'}
            className={cn(
              'relative min-h-[42px] shrink-0 px-3 text-sm transition-colors',
              tab === item.key ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {tab === item.key ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" /> : null}
          </button>
        ))}
      </nav>

      <div className="mt-5 space-y-5">
        {tab === 'profile' ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-y py-4 text-sm">
              <div className="flex min-w-0 items-start gap-3">
                <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                  当前账号 <span className="font-medium text-foreground">@{username}</span>
                  {me?.email ? ` · ${me.email}` : ''}
                  {me?.is_email_verified ? ' · 邮箱已验证' : ' · 邮箱未验证'}
                </div>
              </div>
              {!me?.is_email_verified && me?.email ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={resend.isPending}
                  onClick={() =>
                    resend.mutate(
                      { email: me.email as string },
                      {
                        onSuccess: () => toast.success('验证邮件已重新发送，请查收（含垃圾箱）'),
                        onError: () => toast.error('验证邮件发送失败，可再试一次。'),
                      },
                    )
                  }
                >
                  {resend.isPending ? '发送中…' : '重发验证邮件'}
                </Button>
              ) : null}
            </div>
            <ProfileAreasCard key={`areas-${me?.id ?? 'empty'}`} initial={me ?? undefined} />
            <ProfileDetailsCard key={me?.id ?? 'profile-empty'} initial={me ?? undefined} />
          </>
        ) : null}
        {tab === 'security' ? (
          <div className="space-y-5">
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <TwoFactorSection />
              <ChangePasswordCard />
            </div>
            <AccountDataCard username={username} />
          </div>
        ) : null}
        {tab === 'notifications' ? <NotificationPrefsCard /> : null}
        {tab === 'ai' ? <AiAccessCard /> : null}
      </div>
    </section>
  )
}
