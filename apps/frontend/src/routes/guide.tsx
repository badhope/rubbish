import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { AuthorsPage } from '@/components/guide/authors-page'
import { HelpPage } from '@/components/guide/help-page'
import { LevelsPage } from '@/components/guide/levels-page'
import { PoliciesPage } from '@/components/guide/policies-page'

export const Route = createFileRoute('/guide')({
  validateSearch: (search: Record<string, unknown>) => ({
    tab:
      search.tab === 'help' || search.tab === 'policies' || search.tab === 'levels'
        ? search.tab
        : 'authors',
  }),
  component: GuidePage,
})

const TABS = [
  { value: 'authors', label: '创作指南', desc: '选题、格式、发布与讨论' },
  { value: 'help', label: '使用指南', desc: '发帖、回复、举报与设置' },
  { value: 'policies', label: '社区公约', desc: '内容边界、版权与处理' },
  { value: 'levels', label: '等级与规范', desc: '身份等级、权限与计分口径' },
] as const

function GuidePage() {
  const { tab } = useSearch({ from: '/guide' })
  return (
    <div className="guide-page">
      <div className="mx-auto mb-8 flex w-full max-w-[1100px] overflow-x-auto border-t">
        {TABS.map((t) => (
          <Link
            key={t.value}
            to="/guide"
            search={{ tab: t.value }}
            data-active={tab === t.value}
            className={cn(
              'min-w-0 flex-1 whitespace-nowrap border-b-2 px-0 py-3.5 pr-2 text-left transition-colors',
              tab === t.value
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="block text-sm font-medium">{t.label}</span>
            <span className="mt-0.5 hidden text-[11px] leading-5 text-muted-foreground sm:block">
              {t.desc}
            </span>
          </Link>
        ))}
      </div>
      {tab === 'help' ? (
        <HelpPage />
      ) : tab === 'policies' ? (
        <PoliciesPage />
      ) : tab === 'levels' ? (
        <LevelsPage />
      ) : (
        <AuthorsPage />
      )}
    </div>
  )
}
