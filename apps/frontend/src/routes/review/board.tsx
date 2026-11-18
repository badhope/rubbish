import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Eye, UserCheck } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useExpressReviewInterest, useReviewBoard } from '@/hooks/api/use-modules'
import { extractError } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/review/board')({
  component: ReviewBoardPage,
})

function ReviewBoardPage() {
  const { data, isLoading, isError, refetch } = useReviewBoard()
  const interest = useExpressReviewInterest()
  const token = useAuthStore((s) => s.token)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="审稿广场"
        description="只展示在审稿件的标题、摘要与学科，不公开作者身份和正文。审稿人可以在这里申请审稿，由编辑部统一指派。"
      />
      {isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : isError ? (
        <ErrorState message="审稿广场加载失败" onRetry={() => void refetch()} />
      ) : !data?.data.length ? (
        <EmptyState title="暂无在审稿件" description="当前没有处于审稿中的稿件。" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Eye className="h-4 w-4" />
            共 {data.total} 篇在审；审稿人申请只记录意愿，不会自动获得稿件。
          </div>
          {data.data.map((item) => (
            <Card key={item.submission_id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">审稿中</Badge>
                  {item.type === 'paper' ? <Badge variant="secondary">论文</Badge> : null}
                  {item.discipline ? <Badge variant="outline">{item.discipline}</Badge> : null}
                  <span className="text-xs text-muted-foreground">#{item.submission_id}</span>
                </div>
                <CardTitle className="text-base leading-snug">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {item.abstract ? (
                  <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                    {item.abstract}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">作者未提供摘要。</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <UserCheck className="h-3.5 w-3.5" />
                    已有 {item.reviewer_count} 位审稿人
                  </span>
                  {item.already_assigned ? (
                    <Button size="sm" variant="outline" disabled>
                      已在审稿名单
                    </Button>
                  ) : !token ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/login">登录后申请</Link>
                    </Button>
                  ) : data.can_apply ? (
                    <Button
                      size="sm"
                      disabled={interest.isPending}
                      onClick={() => {
                        interest.mutate(item.submission_id, {
                          onError: (err) => {
                            // 403 时提示先申请角色，而不是假装成功。
                            const message = extractError(err, '申请审稿失败')
                            if (message.includes('Reviewer role required')) {
                              toast.info('请先在等级页申请审稿人资格')
                              window.location.href = '/me?tab=coins&section=levels'
                              return
                            }
                            toast.error(message)
                          },
                        })
                      }}
                    >
                      申请审稿
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/me" search={{ tab: 'coins', section: 'levels' }}>先申请审稿人资格</Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
