/** 投稿向导里的「互评成员专长覆盖」：匿名聚合画像（只有人数与标签，
 * 不含任何互评成员身份），帮作者判断自己方向的互评覆盖情况。 */
import { useState } from 'react'
import { ChevronDown, Users } from 'lucide-react'
import { usePublicExpertise } from '@/hooks/api/use-modules'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export function ExpertiseCoverage({ currentDiscipline }: { currentDiscipline?: string }) {
  const expertise = usePublicExpertise()
  const [open, setOpen] = useState(false)

  const data = expertise.data
  if (!data || data.total_reviewers === 0) return null

  const covered = data.disciplines.filter((d) => d.reviewer_count > 0)
  const current = currentDiscipline?.trim()
  const currentCovered = current
    ? data.disciplines.find((d) => d.name === current)
    : undefined

  return (
    <div className="rounded-md border bg-muted/20" data-testid="expertise-coverage">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={open}
      >
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">互评成员专长覆盖</span>
        <span className="text-xs text-muted-foreground">
          {data.total_reviewers} 位互评成员 · 匿名统计
        </span>
        <ChevronDown
          className={cn('ml-auto h-4 w-4 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {current && (
            <p className="text-xs">
              {currentCovered && currentCovered.reviewer_count > 0 ? (
                <>
                  你选的「{current}」方向现有{' '}
                  <span className="font-medium text-primary">
                    {currentCovered.reviewer_count}
                  </span>{' '}
                  位互评成员覆盖。
                </>
              ) : (
                <>「{current}」方向暂无自选该方向的互评成员，内容整理会按关键词与历史互评匹配。</>
              )}
            </p>
          )}
          {covered.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {covered.map((d) => (
                <Badge
                  key={d.slug}
                  variant={d.name === current ? 'default' : 'secondary'}
                  className="text-[11px]"
                >
                  {d.name} · {d.reviewer_count} 人
                </Badge>
              ))}
            </div>
          )}
          {data.top_tags.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">高频互评能力标签</p>
              <div className="flex flex-wrap gap-1.5">
                {data.top_tags.slice(0, 12).map((t) => (
                  <Badge key={t.tag} variant="outline" className="text-[11px]">
                    {t.tag} × {t.count}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            以上为匿名聚合统计，不展示任何互评成员身份；匿名互评下作者不可见互评成员信息。
          </p>
        </div>
      )}
    </div>
  )
}