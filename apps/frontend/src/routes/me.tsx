import { useEffect, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { ClipboardCheck, Kanban } from 'lucide-react'
import { getAuthState } from '@/lib/auth'
import {
  useMeProfile,
  useUnreadCount,
} from '@/hooks/api/use-modules'
import { useMe } from '@/hooks/api/use-auth'
import { ErrorState, Loading } from '@/components/common/state'
import { MeIdentityHeader } from '@/components/me/me-identity-header'
import { MeActionBar } from '@/components/me/me-action-bar'
import { MeTabNav } from '@/components/me/me-tab-nav'
import { MeOverview } from '@/components/me/me-overview'
import { MeLibrary } from '@/components/me/me-library'
import { MeCreator } from '@/components/me/me-creator'
import { MePoints } from '@/components/me/me-points'
import { MeSettings } from '@/components/me/me-settings'
import { NotificationsDialog } from '@/components/me/notifications-dialog'
import { isMeTab, type MeTabKey } from '@/components/me/types'

export const Route = createFileRoute('/me')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: MeTabKey; section?: string; notifications?: boolean; appeal?: number } => {
    const tab = isMeTab(search.tab) ? search.tab : undefined
    const section = typeof search.section === 'string' ? search.section : undefined
    const notifications =
      search.notifications === true || search.notifications === '1' || search.notifications === 'true'
    const appeal =
      Number.isInteger(Number(search.appeal)) && Number(search.appeal) > 0
        ? Number(search.appeal)
        : undefined
    return {
      ...(tab ? { tab } : {}),
      ...(section ? { section } : {}),
      ...(notifications ? { notifications: true } : {}),
      ...(appeal ? { appeal } : {}),
    }
  },
  beforeLoad: () => {
    if (!getAuthState().isAuthenticated) throw redirect({ to: '/login', search: { redirect: '/me' } })
  },
  component: MePage,
})

function MePage() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const profile = useMeProfile()
  const account = useMe()
  const unread = useUnreadCount()
  const [notificationsOpen, setNotificationsOpen] = useState(Boolean(search.notifications))

  useEffect(() => {
    if (search.notifications) setNotificationsOpen(true)
  }, [search.notifications])

  const setNotificationsVisible = (open: boolean) => {
    setNotificationsOpen(open)
    if (!open && search.notifications) {
      // 关掉弹窗后把深链参数也清掉；否则再点一次铃铛，地址没变化就不会重新打开。
      void navigate({
        to: '/me',
        search: { ...search, notifications: undefined },
        replace: true,
      })
    }
  }

  if (profile.isLoading) return <Loading />
  if (profile.isError || !profile.data) {
    return <ErrorState message="加载我的空间失败" onRetry={() => profile.refetch()} />
  }

  const data = profile.data

  const requestedTab = search.tab ?? 'overview'
  const activeTab: MeTabKey = requestedTab
  const isOverview = activeTab === 'overview'

  const onTabChange = (tab: MeTabKey) => {
    void navigate({ to: '/me', search: { tab }, replace: true })
  }

  // 一级分区：继续写、继续读、经验、设置。
  // 经验是完整的一级页（可签到、兑换、查记录），不是只能从头部卡片钻进去的隐藏路由。
  const tabs = [
    { key: 'overview' as const, label: '继续写' },
    { key: 'creator' as const, label: '创作' },
    { key: 'library' as const, label: '继续读' },
    { key: 'points' as const, label: '经验' },
    { key: 'settings' as const, label: '设置' },
  ]

  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <MeIdentityHeader profile={data} account={account.data} compact={!isOverview} />

      {isOverview ? (
        <MeActionBar
          unreadCount={unread.data?.unread}
          onOpenNotifications={() => setNotificationsOpen(true)}
        />
      ) : null}

      {isOverview && data.permission_role !== 'user' ? (
        <section className="flex flex-wrap items-center gap-3 border-b py-3" aria-label="工作台入口">
          <p className="hidden text-[11px] uppercase tracking-[0.24em] text-muted-foreground sm:block">工作台</p>
          {['reviewer', 'editor', 'editor_in_chief'].includes(data.permission_role) ? (
            <Link
              to="/review"
              search={{ tab: 'assignments' }}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:border-primary hover:text-primary"
            >
              <ClipboardCheck className="h-4 w-4" />
              互评台
            </Link>
          ) : null}
          {['editor', 'editor_in_chief'].includes(data.permission_role) ? (
            <Link
              to="/submissions/pending"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:border-primary hover:text-primary"
            >
              <Kanban className="h-4 w-4" />
              内容台
            </Link>
          ) : null}
          {['editor', 'editor_in_chief'].includes(data.permission_role) ? (
            <Link
              to="/editor/calibration"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors hover:border-primary hover:text-primary"
            >
              互评校准
            </Link>
          ) : null}
        </section>
      ) : null}

      <MeTabNav tabs={tabs} active={activeTab} onChange={onTabChange} />

      <div className="pt-6 sm:pt-7">
        {activeTab === 'overview' ? (
          <MeOverview
            onOpenNotifications={() => setNotificationsOpen(true)}
            highlightAppealId={search.appeal}
            workStats={data.work_stats}
            username={data.username}
          />
        ) : null}
        {activeTab === 'creator' ? <MeCreator /> : null}
        {activeTab === 'library' ? <MeLibrary section={search.section} /> : null}
        {activeTab === 'points' ? <MePoints /> : null}
        {activeTab === 'settings' ? <MeSettings username={data.username} initialSection={search.section} /> : null}
      </div>

      {notificationsOpen ? (
        <NotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsVisible} />
      ) : null}
    </div>
  )
}
