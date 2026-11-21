import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ClipboardCheck, Kanban } from 'lucide-react'
import { requireAdminGuard } from '@/lib/route-guards'
import { AdminSectionTabs, type AdminSectionItem } from '@/components/admin/admin-section-tabs'
import AnnouncementsPage from '@/components/admin/pages/content/announcements'
import ForumBoardsPage from '@/components/admin/pages/content/forum-boards'
import ForumInspectionPage from '@/components/admin/pages/content/forum-inspection'
import ReportsPage from '@/components/admin/pages/content/reports'
import CommentsPage from '@/components/admin/pages/content/comments'

type SectionKey = 'forum' | 'announcements' | 'boards' | 'reports' | 'comments'

interface ContentSearch {
  section?: string
}

const SECTIONS: readonly AdminSectionItem<SectionKey>[] = [
  { key: 'forum', label: '论坛巡检' },
  { key: 'announcements', label: '公告' },
  { key: 'boards', label: '版块' },
  { key: 'reports', label: '举报' },
  { key: 'comments', label: '评论' },
]

function isSectionKey(value: string | undefined): value is SectionKey {
  return (
    value === 'forum' ||
    value === 'announcements' ||
    value === 'boards' ||
    value === 'reports' ||
    value === 'comments'
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
  const [section, setSection] = useState<SectionKey>('forum')

  useEffect(() => {
    if (isSectionKey(sectionParam)) setSection(sectionParam)
  }, [sectionParam])

  const changeSection = (next: SectionKey) => {
    setSection(next)
    navigate({ to: '/admin/content', search: { section: next }, replace: true })
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2.5">
        <span className="mr-1 text-xs text-muted-foreground">编辑业务入口</span>
        <Link
          to="/submissions/pending"
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
        >
          <Kanban className="h-3.5 w-3.5" />
          编辑工作台
        </Link>
        <Link
          to="/review"
          search={{ tab: 'assignments' }}
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
          审稿工作台
        </Link>
        <Link
          to="/editor/calibration"
          className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
        >
          评审校准
        </Link>
      </div>
      <AdminSectionTabs items={SECTIONS} active={section} onChange={changeSection} label="内容域子段" />
      {section === 'forum' ? <ForumInspectionPage /> : null}
      {section === 'announcements' ? <AnnouncementsPage /> : null}
      {section === 'boards' ? <ForumBoardsPage /> : null}
      {section === 'reports' ? <ReportsPage /> : null}
      {section === 'comments' ? <CommentsPage /> : null}
    </div>
  )
}
