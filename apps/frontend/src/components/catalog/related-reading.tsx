import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen } from 'lucide-react'
import { useRelatedResources } from '@/hooks/api/use-related'
import { displayTypeLabel } from '@/lib/resource-labels'

export function RelatedReading({ resourceId }: { resourceId: number }) {
  const query = useRelatedResources(resourceId)
  const rows = query.data?.data ?? []
  if (query.isLoading || query.isError || rows.length === 0) return null

  return (
    <section className="space-y-3" aria-label="延伸阅读">
      <div className="flex items-baseline justify-between gap-3 border-b pb-2">
        <h2 className="text-sm font-medium">继续读</h2>
        <span className="text-[11px] text-muted-foreground">按标签、作者或方向接上</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <Link
            key={row.id}
            to="/catalog/$resourceId"
            params={{ resourceId: String(row.id) }}
            className="group flex gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40"
          >
            {row.cover_image ? (
              <img
                src={row.cover_image}
                alt=""
                className="h-[64px] w-12 shrink-0 rounded-md object-cover"
              />
            ) : (
              <span className="flex h-[64px] w-12 shrink-0 items-center justify-center rounded-md bg-primary/5 text-primary/70">
                <BookOpen className="h-4 w-4" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-medium leading-snug group-hover:text-primary">
                {row.short_title?.trim() || row.title}
              </span>
              <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                {displayTypeLabel(row.type)} · {row.discipline} · {row.year}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {row.author_name}
              </span>
              <span className="mt-2 inline-flex rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] text-primary">
                {row.reason}
              </span>
            </span>
            <ArrowRight className="mt-1 hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-primary sm:block" />
          </Link>
        ))}
      </div>
    </section>
  )
}
