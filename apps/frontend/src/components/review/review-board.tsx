import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Eye, UserCheck } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useExpressReviewInterest, useReviewBoard } from '@/hooks/api/use-modules'
import { extractError } from '@/lib/utils'
import { typeLabel } from '@/lib/resource-labels'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function ReviewBoard() {
  const { data, isLoading, isError, refetch } = useReviewBoard()
  const interest = useExpressReviewInterest()
  const token = useAuthStore((s) => s.token)

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="互评广场"
        description="作品还在互评里，作者和正文先不公开。你能看到标题、简介和主题；想参与，就向站务组申请。"
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/levels" hash="role-applications">
              申请互评成员
            </Link>
          </Button>
        }
      />
      {isLoading ? (
        <LoadingSkeleton rows={4} />
      ) : isError ? (
        <ErrorState message="互评广场加载失败" onRetry={() => void refetch()} />
      ) : !data?.data.length ? (
        <EmptyState title="现在没有作品在互评" description="过一阵再来看看，或者先去内容库读几篇。" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Eye className="h-4 w-4" />
            共 {data.total} 篇在互评；申请只是告诉站务组你想读，不会自动分到作品。
          </div>
          {data.data.map((item) => (
            <Card key={item.submission_id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">互评中</Badge>
                  <Badge variant="secondary">{typeLabel(item.type)}</Badge>
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
                  <p className="text-sm text-muted-foreground">作者未提供简介。</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <UserCheck className="h-3.5 w-3.5" />
                    已有 {item.reviewer_count} 位互评成员
                  </span>
                  {item.already_assigned ? (
                    <Button size="sm" variant="outline" disabled>
                      已在互评名单
                    </Button>
                  ) : !token ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/login" search={{ redirect: '/review?tab=board' }}>登录后申请</Link>
                    </Button>
                  ) : data.can_apply ? (
                    <Button
                      size="sm"
                      disabled={interest.isPending}
                      onClick={() => {
                        interest.mutate(item.submission_id, {
                          onError: (err) => {
                            // 403 时提示先申请角色，而不是假装成功。
                            const message = extractError(err, '申请互评失败')
                            if (message.includes('Reviewer role required')) {
                              toast.info('请先申请互评成员资格')
                              window.location.href = '/levels#role-applications'
                              return
                            }
                            toast.error(message)
                          },
                        })
                      }}
                    >
                      申请互评
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/levels" hash="role-applications">先申请互评成员资格</Link>
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
