import { useEffect } from 'react'
import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { GettingStarted } from '@/components/guide/getting-started'
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
          : search.tab === 'authors'
            ? 'authors'
            : 'start',
  }),
  component: GuidePage,
})

const TABS = [
  { value: 'start', label: '三分钟，先走一遍', desc: '这里有什么、从哪进' },
  { value: 'authors', label: '写作品', desc: '定题、结构、材料与发布' },
  { value: 'help', label: '去讨论', desc: '读帖、发帖、回复与举报' },
  { value: 'policies', label: '规则与边界', desc: '版权、隐私、法律与处理' },
] as const

function GuidePage() {
  const { tab } = useSearch({ from: '/guide' })
  const current = TABS.find((t) => t.value === tab) ?? TABS[0]
  useEffect(() => {
    document.title = `怎么用 · ${current.label} — Rubbish`
  }, [current.label])
  return (
    <div className="guide-page">
      <div className="mx-auto mb-8 flex w-full max-w-[1100px] flex-wrap border-t">
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
      {tab === 'start' ? (
        <GettingStarted />
      ) : tab === 'help' ? (
        <CommunityGuide />
      ) : tab === 'policies' ? (
        <CommunityRules />
      ) : (
        <ResearchGuide />
      )}
    </div>
  )
}
