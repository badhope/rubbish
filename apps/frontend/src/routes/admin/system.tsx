import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireAdminGuard } from '@/lib/route-guards'
import { AdminSectionTabs, type AdminSectionItem } from '@/components/admin/admin-section-tabs'
import SystemHealthPage from '@/components/admin/pages/system/system-health'
import AuditLogsPage from '@/components/admin/pages/system/audit-logs'

type SectionKey = 'health' | 'audit'

interface SystemSearch {
  section?: string
}

const SECTIONS: readonly AdminSectionItem<SectionKey>[] = [
  { key: 'health', label: '系统健康' },
  { key: 'audit', label: '审计日志' },
]

function isSectionKey(value: string | undefined): value is SectionKey {
  return value === 'health' || value === 'audit'
}

export const Route = createFileRoute('/admin/system')({
  validateSearch: (search: Record<string, unknown>): SystemSearch => ({
    section: typeof search.section === 'string' ? search.section : undefined,
  }),
  beforeLoad: () => requireAdminGuard(),
  component: AdminSystemPage,
})

function AdminSystemPage() {
  const navigate = useNavigate()
  const { section: sectionParam } = Route.useSearch()
  const [section, setSection] = useState<SectionKey>('health')

  useEffect(() => {
    if (isSectionKey(sectionParam)) setSection(sectionParam)
  }, [sectionParam])

  const changeSection = (next: SectionKey) => {
    setSection(next)
    navigate({ to: '/admin/system', search: { section: next }, replace: true })
  }

  return (
    <div>
      <AdminSectionTabs items={SECTIONS} active={section} onChange={changeSection} label="系统域子段" />
      {section === 'health' ? <SystemHealthPage /> : null}
      {section === 'audit' ? <AuditLogsPage /> : null}
    </div>
  )
}
