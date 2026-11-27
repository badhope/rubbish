import { Globe2, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Visibility selector for member-curated reading lists.
 *
 * A public list is readable by anonymous visitors, so the copy must say that
 * plainly. The backend still filters unpublished catalog records out of the
 * public response; this control only decides who may open the list itself.
 */
export function VisibilityChoice({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string
  value: 'public' | 'private'
  onChange: (value: 'public' | 'private') => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">谁可以看</legend>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            {
              value: 'private',
              label: '仅自己',
              hint: '先整理，不对外',
              icon: Lock,
            },
            {
              value: 'public',
              label: '公开',
              hint: '出现在公开列表，别人可连读',
              icon: Globe2,
            },
          ] as const
        ).map((option) => {
          const selected = value === option.value
          const Icon = option.icon
          return (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer gap-2 rounded-lg border p-3 text-left transition-colors',
                selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
              )}
            >
              <input
                type="radio"
                name={`${idPrefix}-visibility`}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <Icon
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  selected ? 'text-primary' : 'text-muted-foreground',
                )}
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                  {option.hint}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
