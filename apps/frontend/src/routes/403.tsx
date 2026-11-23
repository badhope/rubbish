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
          <h1 className="text-2xl font-semibold">这一页需要相应权限</h1>
          <p className="text-sm text-muted-foreground">
            说话、回复、收藏对所有人开放。这一页属于站务或内容整理后台，需要相应角色才能进入。
          </p>
          <p className="max-w-sm text-xs text-muted-foreground">
            如果你只是想说话，回讨论区即可；权限问题可以联系站务邮箱。
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline">
              <Link to="/me">
                <ArrowLeft className="h-4 w-4" /> 回到我的
              </Link>
            </Button>
            <Button asChild>
              <Link to="/forum">
                <MessagesSquare className="h-4 w-4" /> 去讨论区
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
