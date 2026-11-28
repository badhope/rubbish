import { useMemo, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { useDisciplines } from '@/hooks/api/use-modules'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * 受控领域选择器：按钮上带已选标签，点开后在弹窗里勾选。
 * 为什么不用逗号输入 slug：`computer-science` 这种值既难记，也容易写错；
 * 受控词表给了 name，就应该让用户看见 name、选 name。
 */
export function DisciplinePicker({
  label,
  value,
  onChange,
  max = 6,
  helper,
  disabled = false,
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  max?: number
  helper?: string
  disabled?: boolean
}) {
  const disciplines = useDisciplines()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<string[]>(value)

  const options = useMemo(() => disciplines.data ?? [], [disciplines.data])
  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of options) map.set(item.slug, item.name)
    return map
  }, [options])

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return options
    return options.filter(
      (item) => item.name.toLowerCase().includes(term) || item.slug.toLowerCase().includes(term),
    )
  }, [options, query])

  const openPicker = () => {
    setDraft(value)
    setQuery('')
    setOpen(true)
  }

  const toggle = (slug: string) => {
    setDraft((current) => {
      if (current.includes(slug)) return current.filter((item) => item !== slug)
      if (current.length >= max) return current
      return [...current, slug]
    })
  }

  const selected = value.map((slug) => ({ slug, name: names.get(slug) ?? slug }))
  const draftSelected = draft.map((slug) => ({ slug, name: names.get(slug) ?? slug }))

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {value.length}/{max}
        </span>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-label={`${label}，已选 ${value.length} 个，最多 ${max} 个`}
        className={cn(
          'flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 py-1.5 text-left text-sm transition-colors',
          'hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        {selected.length > 0 ? (
          <span className="flex min-w-0 flex-wrap gap-1">
            {selected.map((item) => (
              <Badge key={item.slug} variant="secondary" className="max-w-full truncate text-[11px] font-normal">
                {item.name}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">选择{label}</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {helper ? <p className="text-[11px] leading-5 text-muted-foreground">{helper}</p> : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[86vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>选择{label}</DialogTitle>
            <DialogDescription>
              从站内受控词表里选，最多 {max} 个。选的是方向，不是职称；之后可以随时回来改。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 overflow-y-auto pr-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜方向名称或 slug"
                className="pl-8"
              />
            </div>

            {draftSelected.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {draftSelected.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => toggle(item.slug)}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/15"
                  >
                    {item.name}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            ) : null}

            {disciplines.isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">正在读领域词表…</p>
            ) : disciplines.isError ? (
              <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                领域词表没加载出来，稍后重试或直接保存已有选择。
              </p>
            ) : visible.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的领域。</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {visible.map((item) => {
                  const checked = draft.includes(item.slug)
                  const full = !checked && draft.length >= max
                  return (
                    <button
                      key={item.slug}
                      type="button"
                      onClick={() => toggle(item.slug)}
                      disabled={full}
                      aria-pressed={checked}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                        checked
                          ? 'border-primary/35 bg-primary/[0.07] text-primary'
                          : 'border-border bg-background hover:border-primary/30 hover:bg-muted/30',
                        full && 'cursor-not-allowed opacity-45',
                      )}
                    >
                      <span className="truncate">{item.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{item.slug}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              已选 {draft.length}/{max}
              {draft.length >= max ? '，已达上限；先取消一个再选。' : '。'}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={() => { onChange(draft); setOpen(false) }}>
              用这 {draft.length} 个方向
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
