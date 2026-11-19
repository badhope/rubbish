import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireAdminGuard } from '@/lib/route-guards'
import { useVolumeList } from '@/hooks/api/use-modules'
import { AdminSectionTabs, type AdminSectionItem } from '@/components/admin/admin-section-tabs'
import VolumesPage from '@/components/admin/pages/journal/volumes'
import IssuesPage from '@/components/admin/pages/journal/issues'
import ReleasesPage from '@/components/admin/pages/journal/releases'
import JournalInfoPage from '@/components/admin/pages/journal/journal'
import SettingsPage from '@/components/admin/pages/journal/settings'
import { NewResourcePage } from '@/components/admin/pages/journal/new-resource'

type SectionKey = 'volumes' | 'issues' | 'releases' | 'info' | 'resources' | 'settings'

interface JournalSearch {
  section?: string
  volume?: string
}

const SECTIONS: readonly AdminSectionItem<SectionKey>[] = [
  { key: 'volumes', label: '卷' },
  { key: 'issues', label: '期' },
  { key: 'releases', label: '发布' },
  { key: 'info', label: '期刊信息' },
  { key: 'resources', label: '资源录入' },
  { key: 'settings', label: '期刊设置' },
]

function isSectionKey(value: string | undefined): value is SectionKey {
  return value === 'volumes' || value === 'issues' || value === 'releases' || value === 'info' || value === 'resources' || value === 'settings'
}

export const Route = createFileRoute('/admin/journal')({
  validateSearch: (search: Record<string, unknown>): JournalSearch => ({
    section: typeof search.section === 'string' ? search.section : undefined,
    volume: typeof search.volume === 'string' ? search.volume : undefined,
  }),
  beforeLoad: () => requireAdminGuard(),
  component: AdminJournalPage,
})

function AdminJournalPage() {
  const navigate = useNavigate()
  const { section: sectionParam, volume } = Route.useSearch()
  const { data: volumeData } = useVolumeList()
  const effectiveVolume = volume ?? volumeData?.items?.[0]?.volume
  const [section, setSection] = useState<SectionKey>('volumes')

  useEffect(() => {
    if (isSectionKey(sectionParam)) setSection(sectionParam)
  }, [sectionParam])

  const changeSection = (next: SectionKey) => {
    setSection(next)
    navigate({ to: '/admin/journal', search: { section: next }, replace: true })
  }

  return (
    <div>
      <AdminSectionTabs items={SECTIONS} active={section} onChange={changeSection} label="期刊域子段" />
      {section === 'volumes' ? <VolumesPage /> : null}
      {section === 'issues' ? <IssuesPage volume={effectiveVolume} /> : null}
      {section === 'releases' ? <ReleasesPage /> : null}
      {section === 'info' ? <JournalInfoPage /> : null}
      {section === 'resources' ? <NewResourcePage /> : null}
      {section === 'settings' ? <SettingsPage /> : null}
    </div>
  )
}
