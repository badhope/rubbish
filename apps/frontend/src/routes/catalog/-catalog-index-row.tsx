import { Link } from '@tanstack/react-router'
import type { ResourceResponse } from '@/lib/types'
import { formatAuthors, cn } from '@/lib/utils'
import { displayTypeLabel, isScholarlyContent } from '@/lib/resource-labels'
import { essayGenreLabel } from '@/lib/essay-genres'
import { Highlight } from '@/components/common/highlight'

// 论文库的“索引行”：没有封面、没有卡片、没有阴影。
// 一行只承担一件事：让读者在 390px 屏幕上也先看到标题，再决定要不要点。
export function CatalogIndexRow({
  resource,
  query,
  index,
}: {
  resource: ResourceResponse
  query?: string
  index: number
}) {
  const scholarly = isScholarlyContent(resource.content_category, resource.content_track)
  const essay = resource.content_track === 'essay'
  const label = essay
    ? essayGenreLabel(resource.content_genre)
    : displayTypeLabel(resource.type, resource.content_category, resource.content_track, resource.track)
  const meta = [label, resource.discipline, resource.year ? String(resource.year) : null]
    .filter(Boolean)
    .join(' · ')
  const preview = (resource.preview || resource.abstract || '')
    .replace(/[#>*_`~]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return (
    <Link
      to="/catalog/$resourceId"
      params={{ resourceId: String(resource.id) }}
      className="group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-4 transition-colors hover:text-primary"
    >
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {String(index).padStart(2, '0')}
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 text-[15px] font-medium leading-snug sm:text-base">
          <Highlight text={resource.title} query={query} />
        </span>
        <span className="mt-1 block text-[11px] leading-5 text-muted-foreground sm:text-xs">
          {meta}
          {resource.clc_code ? ` · CLC ${resource.clc_code}` : ''}
        </span>
        {preview && (
          <span className="mt-2 line-clamp-2 block text-[12px] leading-5 text-muted-foreground/80">
            {preview}
          </span>
        )}
        <span className="mt-1 block text-[11px] text-muted-foreground/70">
          {formatAuthors(resource.authors) || '佚名'}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          'self-center text-sm text-muted-foreground transition-colors group-hover:text-primary',
          scholarly ? '' : 'text-absurd/70',
        )}
      >
        →
      </span>
    </Link>
  )
}
