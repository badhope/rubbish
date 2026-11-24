import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, ClipboardCheck, Kanban, Layers, SlidersHorizontal } from 'lucide-react'
import { requireEditorGuard } from '@/lib/route-guards'
import { AdminSectionTabs, type AdminSectionItem } from '@/components/admin/admin-section-tabs'
import AnnouncementsPage from '@/components/admin/pages/content/announcements'
import ForumBoardsPage from '@/components/admin/pages/content/forum-boards'
import ForumInspectionPage from '@/components/admin/pages/content/forum-inspection'
import ForumModerationPage from '@/components/admin/pages/content/moderation'
import ReportsPage from '@/components/admin/pages/content/reports'
import CommentsPage from '@/components/admin/pages/content/comments'
import AppealsPage from '@/components/admin/pages/content/appeals'

type SectionKey = 'moderation' | 'forum' | 'announcements' | 'boards' | 'reports' | 'comments' | 'appeals'

interface ContentSearch {
  section?: string
  appeal?: number
  topic?: number
}

const SECTIONS: readonly AdminSectionItem<SectionKey>[] = [
  { key: 'moderation', label: '人工核验' },
  { key: 'forum', label: '主题巡检' },
  { key: 'announcements', label: '公告' },
  { key: 'boards', label: '分区' },
  { key: 'reports', label: '举报' },
  { key: 'comments', label: '评论' },
  { key: 'appeals', label: '申诉' },
]

function isSectionKey(value: string | undefined): value is SectionKey {
  return (
    value === 'moderation' ||
    value === 'forum' ||
    value === 'announcements' ||
    value === 'boards' ||
    value === 'reports' ||
    value === 'comments' ||
    value === 'appeals'
  )
}

export const Route = createFileRoute('/admin/content')({
  validateSearch: (search: Record<string, unknown>): ContentSearch => ({
    section: typeof search.section === 'string' ? search.section : undefined,
    appeal:
      Number.isInteger(Number(search.appeal)) && Number(search.appeal) > 0
        ? Number(search.appeal)
        : undefined,
    topic:
      Number.isInteger(Number(search.topic)) && Number(search.topic) > 0
        ? Number(search.topic)
        : undefined,
  }),
  beforeLoad: () => requireEditorGuard(),
  component: AdminContentPage,
})

const QUICK_ENTRIES = [
  {
    title: '内容台',
    description: '待核验投稿、草稿与发布前的整理。',
    to: '/submissions/pending',
    search: undefined,
    icon: Kanban,
  },
  {
    title: '互评台',
    description: '按指派与进度处理互评任务。',
    to: '/review',
    search: { tab: 'assignments' },
    icon: ClipboardCheck,
  },
  {
    title: '互评校准',
    description: '查看成员季度校准与评分偏差。',
    to: '/editor/calibration',
    search: undefined,
    icon: SlidersHorizontal,
  },
  {
    title: '合集编排',
    description: '按卷组织文章顺序与封面。',
    to: '/editor/issue-plan',
    search: undefined,
    icon: Layers,
  },
] as const

function AdminContentPage() {
  const navigate = useNavigate()
  const { section: sectionParam, appeal, topic } = Route.useSearch()
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
      <div className="mb-4">
        <p className="mb-2 text-xs text-muted-foreground">跨域工作台</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {QUICK_ENTRIES.map((entry) => {
            const Icon = entry.icon
            return (
            <Link
              key={entry.title}
              to={entry.to}
              search={entry.search as never}
              className="group rounded-xl border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-primary/[0.03]"
            >
              <div className="flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-sm font-medium">
                    {entry.title}
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {entry.description}
                  </p>
                </div>
              </div>
            </Link>
            )
          })}
        </div>
      </div>
      <AdminSectionTabs items={SECTIONS} active={section} onChange={changeSection} label="内容域子段" />
      {section === 'moderation' ? <ForumModerationPage highlightTopicId={topic} /> : null}
      {section === 'forum' ? <ForumInspectionPage /> : null}
      {section === 'announcements' ? <AnnouncementsPage /> : null}
      {section === 'boards' ? <ForumBoardsPage /> : null}
      {section === 'reports' ? <ReportsPage /> : null}
      {section === 'comments' ? <CommentsPage /> : null}
      {section === 'appeals' ? (
        <AppealsPage
          highlightAppealId={appeal}
          onClearHighlight={() => navigate({ to: '/admin/content', search: { section: 'appeals' }, replace: true })}
        />
      ) : null}
    </div>
  )
}
