import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireAdminGuard } from '@/lib/route-guards'
import { AdminSectionTabs, type AdminSectionItem } from '@/components/admin/admin-section-tabs'
import UsersPage from '@/components/admin/pages/people/users'
import RoleApplicationsPage from '@/components/admin/pages/people/role-applications'
import ClaimsPage from '@/components/admin/pages/people/claims'

type SectionKey = 'users' | 'roles' | 'claims'

interface PeopleSearch {
  section?: string
}

const SECTIONS: readonly AdminSectionItem<SectionKey>[] = [
  { key: 'users', label: '用户管理' },
  { key: 'roles', label: '角色申请' },
  { key: 'claims', label: '认领审批' },
]

function isSectionKey(value: string | undefined): value is SectionKey {
  return value === 'users' || value === 'roles' || value === 'claims'
}

export const Route = createFileRoute('/admin/people')({
  validateSearch: (search: Record<string, unknown>): PeopleSearch => ({
    section: typeof search.section === 'string' ? search.section : undefined,
  }),
  beforeLoad: () => requireAdminGuard(),
  component: AdminPeoplePage,
})

function AdminPeoplePage() {
  const navigate = useNavigate()
  const { section: sectionParam } = Route.useSearch()
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
      {section === 'roles' ? <RoleApplicationsPage /> : null}
      {section === 'claims' ? <ClaimsPage /> : null}
    </div>
  )
}
