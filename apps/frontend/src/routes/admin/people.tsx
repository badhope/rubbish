import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireAdminGuard } from '@/lib/route-guards'
import { AdminSectionTabs, type AdminSectionItem } from '@/components/admin/admin-section-tabs'
import UsersPage from '@/components/admin/pages/people/users'
import ClaimsPage from '@/components/admin/pages/people/claims'

type SectionKey = 'users' | 'claims'

interface PeopleSearch {
  section?: string
  /** 通知深链：定位到某一条认领申请。 */
  claim?: number
}

const SECTIONS: readonly AdminSectionItem<SectionKey>[] = [
  { key: 'users', label: '成员管理' },
  { key: 'claims', label: '认领' },
]

function isSectionKey(value: string | undefined): value is SectionKey {
  return value === 'users' || value === 'claims'
}

export const Route = createFileRoute('/admin/people')({
  validateSearch: (search: Record<string, unknown>): PeopleSearch => ({
    section: typeof search.section === 'string' ? search.section : undefined,
    claim:
      Number.isInteger(Number(search.claim)) && Number(search.claim) > 0
        ? Number(search.claim)
        : undefined,
  }),
  beforeLoad: () => requireAdminGuard(),
  component: AdminPeoplePage,
})

function AdminPeoplePage() {
  const navigate = useNavigate()
  const { section: sectionParam, claim } = Route.useSearch()
  const [section, setSection] = useState<SectionKey>('users')

  useEffect(() => {
    if (isSectionKey(sectionParam)) setSection(sectionParam)
  }, [sectionParam])

  const changeSection = (next: SectionKey) => {
    setSection(next)
    navigate({ to: '/admin/people', search: { section: next }, replace: true })
  }

  return (
    <div>
      <AdminSectionTabs items={SECTIONS} active={section} onChange={changeSection} label="用户域子段" />
      {section === 'users' ? <UsersPage /> : null}
      {section === 'claims' ? <ClaimsPage highlightClaimId={claim} /> : null}
    </div>
  )
}
