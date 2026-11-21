import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, MessagesSquare, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export const Route = createFileRoute('/403')({
  component: ForbiddenPage,
})

function ForbiddenPage() {
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <ShieldOff className="h-7 w-7 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold">这个页面需要后台权限</h1>
          <p className="text-sm text-muted-foreground">
            发帖、回复、收藏对所有成员开放，不需要后台角色；
            这里进不去，是因为当前页面属于管理/编辑后台。
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            公告和后台页面才需要编辑或管理员角色；如果只是想发帖，直接去社区即可。
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/me">
                <ArrowLeft className="h-4 w-4" /> 返回我的
              </Link>
            </Button>
            <Button asChild>
              <Link to="/forum">
                <MessagesSquare className="h-4 w-4" /> 去社区发帖
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
