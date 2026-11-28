import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireEditorGuard } from '@/lib/route-guards'
import { AdminSectionTabs, type AdminSectionItem } from '@/components/admin/admin-section-tabs'
import { useAuth } from '@/hooks/use-auth'
import AccessSettingsPage from '@/components/admin/pages/system/access-settings'
import SystemHealthPage from '@/components/admin/pages/system/system-health'
import AuditLogsPage from '@/components/admin/pages/system/audit-logs'
import OpsReportPage from '@/components/admin/pages/system/ops-report'

type SectionKey = 'access' | 'health' | 'audit' | 'ops'

interface SystemSearch {
  section?: string
}

const SECTIONS: readonly AdminSectionItem<SectionKey>[] = [
  { key: 'access', label: '访问设置' },
  { key: 'health', label: '系统健康' },
  { key: 'audit', label: '审计日志' },
  { key: 'ops', label: '运营月报' },
]

function isSectionKey(value: string | undefined): value is SectionKey {
  return value === 'access' || value === 'health' || value === 'audit' || value === 'ops'
}

export const Route = createFileRoute('/admin/system')({
  validateSearch: (search: Record<string, unknown>): SystemSearch => ({
    section: typeof search.section === 'string' ? search.section : undefined,
  }),
  beforeLoad: () => requireEditorGuard(),
  component: AdminSystemPage,
})

function AdminSystemPage() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const { section: sectionParam } = Route.useSearch()
  const [section, setSection] = useState<SectionKey>('access')
  // 编辑只开放“访问设置”；系统健康、审计、运营月报仍留给站务管理员。
  const visibleSections = isAdmin ? SECTIONS : SECTIONS.filter((item) => item.key === 'access')
  const activeSection: SectionKey = isAdmin ? section : 'access'

  useEffect(() => {
    if (isAdmin && isSectionKey(sectionParam)) setSection(sectionParam)
    if (!isAdmin) setSection('access')
  }, [isAdmin, sectionParam])

  const changeSection = (next: SectionKey) => {
    if (!isAdmin && next !== 'access') return
    setSection(next)
    navigate({ to: '/admin/system', search: { section: next }, replace: true })
  }

  return (
    <div>
      <AdminSectionTabs
        items={visibleSections}
        active={activeSection}
        onChange={changeSection}
        label="系统域子段"
      />
      {activeSection === 'access' ? <AccessSettingsPage /> : null}
      {activeSection === 'health' ? <SystemHealthPage /> : null}
      {activeSection === 'audit' ? <AuditLogsPage /> : null}
      {activeSection === 'ops' ? <OpsReportPage /> : null}
    </div>
  )
}
