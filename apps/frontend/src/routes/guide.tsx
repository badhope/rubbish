import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { ResearchGuide } from '@/components/guide/research-guide'
import { CommunityGuide } from '@/components/guide/community-guide'
import { CommunityRules } from '@/components/guide/community-rules'

export const Route = createFileRoute('/guide')({
  validateSearch: (search: Record<string, unknown>) => ({
    tab:
      search.tab === 'help'
        ? 'help'
        : search.tab === 'policies'
          ? 'policies'
          : search.tab === 'levels'
            ? 'help'
            : 'authors',
  }),
  component: GuidePage,
})

const TABS = [
  { value: 'authors', label: '文章指南', desc: '定题、结构、记录与发布' },
  { value: 'help', label: '社区指南', desc: '阅读、发布、回复与举报' },
  { value: 'policies', label: '社区公约', desc: '边界、版权与处理' },
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
        <CommunityGuide />
      ) : tab === 'policies' ? (
        <CommunityRules />
      ) : (
        <ResearchGuide />
      )}
    </div>
  )
}
