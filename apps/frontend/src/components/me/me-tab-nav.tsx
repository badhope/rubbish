import { cn } from '@/lib/utils'
import type { MeTabKey } from './types'

export interface MeTabItem {
  key: MeTabKey
  label: string
  badge?: number | null
}

export function MeTabNav({
  tabs,
  active,
  onChange,
}: {
  tabs: MeTabItem[]
  active: MeTabKey
  onChange: (tab: MeTabKey) => void
}) {
  return (
    <nav
      aria-label="我的功能"
      className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            aria-current={selected ? 'page' : undefined}
            data-active={selected ? 'true' : 'false'}
            onClick={() => onChange(tab.key)}
            className={cn(
              'relative inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-sm transition-colors sm:px-4',
              selected
                ? 'font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
            {tab.badge ? (
              <span className="rounded-full bg-destructive px-1.5 py-0.5 font-mono text-[10px] leading-none text-destructive-foreground">
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            ) : null}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-2 bottom-0 h-0.5 transition-opacity',
                selected ? 'bg-primary opacity-100' : 'opacity-0',
              )}
            />
          </button>
        )
      })}
    </nav>
  )
}
