import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bookmark } from 'lucide-react'
import { recommendationReason } from '@/lib/resource-labels'
import { useMyRecommendations } from '@/hooks/api/use-modules'
import { AddToListDialog } from '@/components/common/add-to-list-dialog'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const LIMIT_OPTIONS = [5, 10, 20, 50]
const DEFAULT_LIMIT = 10

export function MeRecommendations() {
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [listResourceId, setListResourceId] = useState<number | null>(null)

  const { data, isLoading, isError, refetch } = useMyRecommendations(limit)

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">FOR YOU</p>
          <h2 className="mt-1 font-serif text-xl tracking-tight">为你推荐</h2>
          <p className="mt-1 text-xs text-muted-foreground">基于阅读历史与关注学科；没有历史时先给最新收录。</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">条数</span>
          <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
            <SelectTrigger size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMIT_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} 条
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="加载推荐失败" onRetry={() => refetch()} />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          title="暂无推荐"
          description="资源库还没有可推荐的条目，导入一些资源后即可获得个性化推荐"
        />
      ) : (
        <div className="space-y-4">
          {data.data.map((r) => {
            // 推荐分通常为 0~1，转成可读百分比
            const percent = Math.round(r.score * 100)
            // 无阅读历史时后端回退到最新资源，此时没有真实匹配度
            const isFallback = r.score === 0
            return (
              <Card key={r.id}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/catalog/$resourceId"
                        params={{ resourceId: String(r.id) }}
                        className="text-base font-semibold hover:text-primary"
                      >
                        {r.title}
                      </Link>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {r.authors.join(', ')}
                        {r.year ? ` · ${r.year}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setListResourceId(r.id)}
                    >
                      <Bookmark className="h-4 w-4" />
                      加入阅读列表
                    </Button>
                  </div>

                  {/* 推荐理由高亮：有历史时是匹配依据，无历史时是兜底说明 */}
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/15 text-amber-700"
                  >
                    {isFallback
                      ? '最新收录 · 阅读后可获得个性化推荐'
                      : recommendationReason(r.reason)}
                  </Badge>

                  {/* 匹配度进度条 */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{isFallback ? '推荐依据' : '匹配度'}</span>
                      <span className="font-medium text-foreground">
                        {isFallback ? '最新' : `${percent}%`}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-2 rounded-full bg-primary transition-all"
                        style={{ width: `${Math.max(percent, 4)}%` }}
                      />
                    </div>
                  </div>

                  {r.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <Badge key={t} variant="outline">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {(r.discipline || r.subdiscipline) && (
                    <p className="text-xs text-muted-foreground">
                      {[r.discipline, r.subdiscipline]
                        .filter(Boolean)
                        .join(' / ')}
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {listResourceId !== null && (
        <AddToListDialog
          resourceId={listResourceId}
          open={listResourceId !== null}
          onOpenChange={(open) => {
            if (!open) setListResourceId(null)
          }}
        />
      )}
    </div>
  )
}
