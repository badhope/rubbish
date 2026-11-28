import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireChiefGuard } from '@/lib/route-guards'
import { AdminSectionTabs, type AdminSectionItem } from '@/components/admin/admin-section-tabs'
import UsersPage from '@/components/admin/pages/people/users'
import ClaimsPage from '@/components/admin/pages/people/claims'
import RolesPage from '@/components/admin/pages/people/roles'

type SectionKey = 'users' | 'claims' | 'roles'

interface PeopleSearch {
  section?: string
  /** 通知深链：定位到某一条认领申请。 */
  claim?: number
  /** 通知深链：定位到某一条角色申请。 */
  application?: number
}

const SECTIONS: readonly AdminSectionItem<SectionKey>[] = [
  { key: 'users', label: '成员管理' },
  { key: 'claims', label: '认领' },
  { key: 'roles', label: '角色申请' },
]

function isSectionKey(value: string | undefined): value is SectionKey {
  return value === 'users' || value === 'claims' || value === 'roles'
}

export const Route = createFileRoute('/admin/people')({
  validateSearch: (search: Record<string, unknown>): PeopleSearch => ({
    section: typeof search.section === 'string' ? search.section : undefined,
    claim:
      Number.isInteger(Number(search.claim)) && Number(search.claim) > 0
        ? Number(search.claim)
        : undefined,
    application:
      Number.isInteger(Number(search.application)) && Number(search.application) > 0
        ? Number(search.application)
        : undefined,
  }),
  beforeLoad: () => requireChiefGuard(),
  component: AdminPeoplePage,
})

function AdminPeoplePage() {
  const navigate = useNavigate()
  const { section: sectionParam, claim, application } = Route.useSearch()
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
      {section === 'roles' ? (
        <RolesPage
          highlightApplicationId={application}
          onClearHighlight={() =>
            navigate({ to: '/admin/people', search: { section: 'roles' }, replace: true })
          }
        />
      ) : null}
    </div>
  )
}
