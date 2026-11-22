import { cn } from '@/lib/utils'

export interface AdminSectionItem<K extends string = string> {
  key: K
  label: string
}

interface AdminSectionTabsProps<K extends string> {
  items: readonly AdminSectionItem<K>[]
  active: K
  onChange: (key: K) => void
  label?: string
}

/** 同一业务域内的页面切换：一个页面，多个段；不再为每个段保留独立 URL。 */
export function AdminSectionTabs<K extends string>({
  items,
  active,
  onChange,
  label = '当前业务域子段',
}: AdminSectionTabsProps<K>) {
  return (
    <nav aria-label={label} className="-mx-1 flex flex-wrap gap-1 border-b">
      {items.map((item) => {
        const selected = item.key === active
        return (
          <button
            key={item.key}
            type="button"
            aria-current={selected ? 'page' : undefined}
            onClick={() => onChange(item.key)}
            className={cn(
              'relative inline-flex min-h-[40px] shrink-0 items-center px-2.5 text-[11px] transition-colors sm:text-xs',
              selected ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {selected ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" /> : null}
          </button>
        )
      })}
    </nav>
  )
}
