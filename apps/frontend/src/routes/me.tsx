import { useEffect, useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { getAuthState } from '@/lib/auth'
import { useAuth } from '@/hooks/use-auth'
import {
  useMeProfile,
  useMyReviewAssignments,
  useMySubmissions,
  useReadingLists,
  useUnreadCount,
} from '@/hooks/api/use-modules'
import { useMe } from '@/hooks/api/use-auth'
import { ErrorState, Loading } from '@/components/common/state'
import { MeIdentityHeader } from '@/components/me/me-identity-header'
import { MeQuickActions } from '@/components/me/me-quick-actions'
import { MeTabNav } from '@/components/me/me-tab-nav'
import { MeOverview } from '@/components/me/me-overview'
import { MeSubmissions } from '@/components/me/me-submissions'
import { MeReviews } from '@/components/me/me-reviews'
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
  const { user } = useAuth()
  const profile = useMeProfile()
  const account = useMe()
  const submissions = useMySubmissions(undefined, 1, 1)
  const reviewAccess = Boolean(
    profile.data &&
      (profile.data.identities.includes('reviewer') ||
        profile.data.permission_role === 'reviewer' ||
        profile.data.permission_role === 'editor_in_chief' ||
        (user?.roles ?? []).some((role) => ['reviewer', 'senior_reviewer'].includes(role))),
  )
  const pendingReviews = useMyReviewAssignments('pending', 1, 1, { enabled: reviewAccess })
  const readingLists = useReadingLists(1, 1)
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
  const reviewable = reviewAccess

  const requestedTab = search.tab ?? 'overview'
  const activeTab: MeTabKey =
    requestedTab === 'reviews' && !reviewable ? 'overview' : requestedTab

  const onTabChange = (tab: MeTabKey) => {
    void navigate({ to: '/me', search: { tab }, replace: true })
  }

  const tabs = [
    { key: 'overview' as const, label: '概览' },
    { key: 'submissions' as const, label: '投稿' },
    ...(reviewable ? [{ key: 'reviews' as const, label: '审稿' }] : []),
    { key: 'library' as const, label: '收藏' },
    { key: 'points' as const, label: '积分' },
    { key: 'settings' as const, label: '设置' },
  ]

  return (
    <div className="mx-auto w-full max-w-[1120px]">
      <MeIdentityHeader profile={data} account={account.data} />

      <MeQuickActions
        submissionCount={submissions.data?.meta.total}
        reviewCount={reviewable ? pendingReviews.data?.meta.total : undefined}
        reviewable={reviewable}
        libraryCount={readingLists.data?.meta.total}
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
        {activeTab === 'submissions' ? <MeSubmissions section={search.section} /> : null}
        {activeTab === 'reviews' && reviewable ? <MeReviews reviewable={reviewable} /> : null}
        {activeTab === 'library' ? <MeLibrary /> : null}
        {activeTab === 'points' ? <MePoints profile={data} /> : null}
        {activeTab === 'settings' ? <MeSettings username={data.username} initialSection={search.section} /> : null}
      </div>

      {notificationsOpen ? (
        <NotificationsDialog open={notificationsOpen} onOpenChange={setNotificationsOpen} />
      ) : null}
    </div>
  )
}
