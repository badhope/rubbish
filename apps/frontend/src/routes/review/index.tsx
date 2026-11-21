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
          title="互评台"
          description="这里只对互评成员、资深互评成员和内容整理开放。"
        />
        {isAuthenticated ? (
          <EmptyState
            title="当前账号还没有互评权限"
            description="可以先到互评广场浏览互评中的作品，或联系站务组开通互评权限。"
          />
        ) : (
          <EmptyState
            title="登录后进入互评台"
            description="互评邀请、待评作品和已提交意见都跟账号绑定。"
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
              去互评广场
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
              我的互评
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
            互评广场
          </Link>
        </div>
      </div>
      {tab === 'assignments' ? <ReviewAssignments /> : <ReviewBoard />}
    </div>
  )
}
