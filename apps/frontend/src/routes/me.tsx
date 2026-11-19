import { useEffect, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
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
import { MePoints } from '@/components/me/me-points'
import { MeSettings } from '@/components/me/me-settings'
import { NotificationsDialog } from '@/components/me/notifications-dialog'
import { isMeTab, type MeTabKey } from '@/components/me/types'

export const Route = createFileRoute('/me')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: MeTabKey; section?: string; notifications?: boolean } => {
    const tab = isMeTab(search.tab) ? search.tab : undefined
    const section = typeof search.section === 'string' ? search.section : undefined
    const notifications =
      search.notifications === true || search.notifications === '1' || search.notifications === 'true'
    return {
      ...(tab ? { tab } : {}),
      ...(section ? { section } : {}),
      ...(notifications ? { notifications: true } : {}),
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
  // 社区版不再暴露审稿入口；历史审稿数据与接口保留，但不在个人中心出现。
  const reviewable = false
  const unread = useUnreadCount()
  const [notificationsOpen, setNotificationsOpen] = useState(Boolean(search.notifications))

  useEffect(() => {
    if (search.notifications) setNotificationsOpen(true)
  }, [search.notifications])

  if (profile.isLoading) return <Loading />
  if (profile.isError || !profile.data) {
    return <ErrorState message="加载个人中心失败" onRetry={() => profile.refetch()} />
  }

  const data = profile.data

  const requestedTab = search.tab ?? 'overview'
  const activeTab: MeTabKey =
    requestedTab === 'reviews' || requestedTab === 'submissions' ? 'overview' : requestedTab

  const onTabChange = (tab: MeTabKey) => {
    void navigate({ to: '/me', search: { tab }, replace: true })
  }

  const tabs = [
    { key: 'overview' as const, label: '概览' },
    { key: 'library' as const, label: '收藏' },
    { key: 'points' as const, label: '积分' },
    { key: 'settings' as const, label: '设置' },
  ]

  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <MeIdentityHeader profile={data} account={account.data} />

      <MeActionBar
        unreadCount={unread.data?.unread}
        onOpenNotifications={() => setNotificationsOpen(true)}
      />

      <MeTabNav tabs={tabs} active={activeTab} onChange={onTabChange} />

      <div className="pt-6 sm:pt-7">
        {activeTab === 'overview' ? (
          <MeOverview
            reviewable={reviewable}
            onOpenNotifications={() => setNotificationsOpen(true)}
          />
        ) : null}
        {activeTab === 'library' ? <MeLibrary section={search.section} /> : null}
        {activeTab === 'points' ? <MePoints profile={data} /> : null}
        {activeTab === 'settings' ? <MeSettings username={data.username} initialSection={search.section} /> : null}
      </div>

      {notificationsOpen ? (
        <NotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsOpen} />
      ) : null}
    </div>
  )
}
