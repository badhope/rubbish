import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireShopManagerGuard } from '@/lib/route-guards'
import { useAuth } from '@/hooks/use-auth'
import { AdminSectionTabs, type AdminSectionItem } from '@/components/admin/admin-section-tabs'
import FinancePage from '@/components/admin/pages/economy/finance'
import ShopPage from '@/components/admin/pages/economy/shop'

type SectionKey = 'shop' | 'finance'

interface EconomySearch {
  section?: string
}

const ALL_SECTIONS: readonly AdminSectionItem<SectionKey>[] = [
  { key: 'shop', label: '积分' },
  { key: 'finance', label: '成本账本' },
]

function isSectionKey(value: string | undefined): value is SectionKey {
  return value === 'shop' || value === 'finance'
}

export const Route = createFileRoute('/admin/economy')({
  validateSearch: (search: Record<string, unknown>): EconomySearch => ({
    section: typeof search.section === 'string' ? search.section : undefined,
  }),
  beforeLoad: () => requireShopManagerGuard(),
  component: AdminEconomyPage,
})

function AdminEconomyPage() {
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const roles = user?.roles ?? []
  const canFinance =
    isAdmin || roles.some((role) => ['chief_editor', 'deputy_editor', 'editor_in_chief'].includes(role))
  const sections = canFinance ? ALL_SECTIONS : ALL_SECTIONS.filter((item) => item.key === 'shop')
  const [section, setSection] = useState<SectionKey>('shop')
  const { section: sectionParam } = Route.useSearch()

  useEffect(() => {
    if (!isSectionKey(sectionParam)) return
    if (sectionParam === 'finance' && !canFinance) {
      setSection('shop')
      return
    }
    setSection(sectionParam)
  }, [sectionParam, canFinance])

  const changeSection = (next: SectionKey) => {
    if (next === 'finance' && !canFinance) return
    setSection(next)
    navigate({ to: '/admin/economy', search: { section: next }, replace: true })
  }

  return (
    <div>
      <AdminSectionTabs items={sections} active={section} onChange={changeSection} label="经济域子段" />
      {section === 'shop' ? <ShopPage /> : null}
      {section === 'finance' && canFinance ? <FinancePage /> : null}
    </div>
  )
}
