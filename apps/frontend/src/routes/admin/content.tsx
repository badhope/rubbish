import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireAdminGuard } from '@/lib/route-guards'
import { AdminSectionTabs, type AdminSectionItem } from '@/components/admin/admin-section-tabs'
import AnnouncementsPage from '@/components/admin/pages/content/announcements'
import ForumBoardsPage from '@/components/admin/pages/content/forum-boards'
import ReportsPage from '@/components/admin/pages/content/reports'
import CommentsPage from '@/components/admin/pages/content/comments'
import DeskSubscribersPage from '@/components/admin/pages/content/desk-subscribers'

type SectionKey = 'announcements' | 'boards' | 'reports' | 'comments' | 'subscribers'

interface ContentSearch {
  section?: string
}

const SECTIONS: readonly AdminSectionItem<SectionKey>[] = [
  { key: 'announcements', label: '公告' },
  { key: 'boards', label: '版块' },
  { key: 'reports', label: '举报' },
  { key: 'comments', label: '评论' },
  { key: 'subscribers', label: '邮件订阅' },
]

function isSectionKey(value: string | undefined): value is SectionKey {
  return (
    value === 'announcements' ||
    value === 'boards' ||
    value === 'reports' ||
    value === 'comments' ||
    value === 'subscribers'
  )
}

export const Route = createFileRoute('/admin/content')({
  validateSearch: (search: Record<string, unknown>): ContentSearch => ({
    section: typeof search.section === 'string' ? search.section : undefined,
  }),
  beforeLoad: () => requireAdminGuard(),
  component: AdminContentPage,
})

function AdminContentPage() {
  const navigate = useNavigate()
  const { section: sectionParam } = Route.useSearch()
  const [section, setSection] = useState<SectionKey>('announcements')

  useEffect(() => {
    if (isSectionKey(sectionParam)) setSection(sectionParam)
  }, [sectionParam])

  const changeSection = (next: SectionKey) => {
    setSection(next)
    navigate({ to: '/admin/content', search: { section: next }, replace: true })
  }

  return (
    <div>
      <AdminSectionTabs items={SECTIONS} active={section} onChange={changeSection} label="内容域子段" />
      {section === 'announcements' ? <AnnouncementsPage /> : null}
      {section === 'boards' ? <ForumBoardsPage /> : null}
      {section === 'reports' ? <ReportsPage /> : null}
      {section === 'comments' ? <CommentsPage /> : null}
      {section === 'subscribers' ? <DeskSubscribersPage /> : null}
    </div>
  )
}
