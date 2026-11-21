import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { ClipboardCheck, Eye } from 'lucide-react'
import { ReviewAssignments } from '@/components/review/review-assignments'
import { ReviewBoard } from '@/components/review/review-board'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState } from '@/components/common/state'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/review/')({
  component: ReviewHubPage,
})

interface ReviewHubSearch {
  tab?: 'assignments' | 'board'
}

const REVIEWER_ROLES = ['reviewer', 'senior_reviewer', 'editor', 'editor_in_chief']

function ReviewHubPage() {
  const search = useSearch({ strict: false }) as ReviewHubSearch
  const { isAuthenticated, isAdmin, user } = useAuth()
  const canReview =
    isAdmin || (user?.roles ?? []).some((role) => REVIEWER_ROLES.includes(role))
  const requestedTab = search.tab
  const tab =
    requestedTab === 'board'
      ? 'board'
      : requestedTab === 'assignments'
        ? 'assignments'
        : canReview
          ? 'assignments'
          : 'board'

  if (tab === 'assignments' && !canReview) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <PageHeader
          title="审稿工作台"
          description="这里只对审稿人、资深审稿人和主编开放。"
        />
        {isAuthenticated ? (
          <EmptyState
            title="当前账号没有审稿权限"
            description="可以先到审稿广场浏览在审稿件，或联系编辑部申请审稿人角色。"
          />
        ) : (
          <EmptyState
            title="登录后进入审稿工作台"
            description="审稿邀请、待审稿件和已提交意见都跟账号绑定。"
          />
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {!isAuthenticated && (
            <Button asChild>
              <Link to="/login" search={{ redirect: '/review?tab=assignments' }}>
                去登录
              </Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to="/review" search={{ tab: 'board' }}>
              去审稿广场
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
        <div className="inline-flex rounded-lg border bg-muted/30 p-1">
          {canReview && (
            <Link
              to="/review"
              search={{ tab: 'assignments' }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                tab === 'assignments'
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <ClipboardCheck className="h-4 w-4" />
              我的审稿
            </Link>
          )}
          <Link
            to="/review"
            search={{ tab: 'board' }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              tab === 'board'
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Eye className="h-4 w-4" />
            审稿广场
          </Link>
        </div>
      </div>
      {tab === 'assignments' ? <ReviewAssignments /> : <ReviewBoard />}
    </div>
  )
}
