import { Link } from '@tanstack/react-router'
import type { ResourceStats } from '@/lib/types'

/**
 * 内容光谱：用一条堆叠条和一组可点击的横条，回答“站里到底有什么”。
 *
 * 这不是运营仪表盘。它只展示公开目录的构成，并把每个数字变成筛选入口；
 * 读者不需要先理解“轨道 / 类别 / 学科”三套词，再开始找文章。
 */
export function ContentSpectrum({ stats }: { stats?: ResourceStats }) {
  if (!stats) return null

  const serious = stats.by_paper_kind?.serious ?? 0
  const absurd = stats.by_paper_kind?.absurd ?? 0
  const essay = stats.by_track?.essay ?? 0
  const total = serious + absurd + essay
  if (total <= 0) return null

  const segments = [
    { key: 'serious', label: '实证研究', count: serious, color: 'bg-primary', to: { kind: 'serious' as const } },
    { key: 'absurd', label: '荒诞研究', count: absurd, color: 'bg-absurd', to: { kind: 'absurd' as const } },
    { key: 'essay', label: '自由创作', count: essay, color: 'bg-amber-500', to: { track: 'essay' as const } },
  ].filter((segment) => segment.count > 0)

  const disciplines = Object.entries(stats.by_discipline ?? {})
    .filter(([name]) => name && name !== '未分类')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const maxDiscipline = disciplines[0]?.[1] ?? 1

  return (
    <section className="mt-10 border-y py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">Content map</p>
          <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight">内容光谱</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            先看站里有什么，再决定从哪进。每一段颜色和每一根横条都可以直接点进去。
          </p>
        </div>
        <p className="font-mono text-sm tabular-nums text-muted-foreground">{total} 篇</p>
      </div>

      <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-muted" aria-label="内容构成">
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={segment.color}
            style={{ width: `${(segment.count / total) * 100}%` }}
            title={`${segment.label} ${segment.count} 篇`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {segments.map((segment) => (
          <Link
            key={segment.key}
            to="/catalog"
            search={segment.to}
            className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-primary"
          >
            <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${segment.color}`} />
            <span>{segment.label}</span>
            <span className="font-mono text-xs tabular-nums">{segment.count}</span>
          </Link>
        ))}
      </div>

      {disciplines.length > 0 ? (
        <div className="mt-7 grid gap-x-10 gap-y-3 sm:grid-cols-2">
          {disciplines.map(([name, count]) => (
            <Link
              key={name}
              to="/catalog"
              search={{ track: 'paper', discipline: name }}
              className="group grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm"
            >
              <span className="truncate text-muted-foreground transition-colors group-hover:text-foreground">
                {name}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary/70 transition-all group-hover:bg-primary"
                  style={{ width: `${Math.max((count / maxDiscipline) * 100, 4)}%` }}
                />
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  )
}
