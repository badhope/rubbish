import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, LogOut, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { useLogout } from '@/hooks/api/use-auth'
import { filterNav } from '@/lib/nav'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/common/page-header'
import { cn } from '@/lib/utils'
import { MOBILE_MORE, MOBILE_MORE_GROUP_ORDER } from '@/components/layout/mobile-nav'

export const Route = createFileRoute('/more')({
  component: MorePage,
})

function MorePage() {
  const { isAuthenticated, isAdmin, user } = useAuth()
  const navigate = useNavigate()
  const logoutMut = useLogout()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ 我的空间: true })

  const items = filterNav(MOBILE_MORE, {
    isAuthenticated,
    isAdmin,
    roles: user?.roles ?? [],
  })

  const toggleGroup = (group: string) => {
    setOpenGroups((current) => ({ ...current, [group]: !current[group] }))
  }

  const onLogout = async () => {
    try {
      await logoutMut.mutateAsync()
      toast.success('已退出登录')
      void navigate({ to: '/' })
    } catch {
      toast.error('退出没成功，过一会儿再试')
    }
  }

  return (
    <div className="mx-auto w-full max-w-screen-sm space-y-6">
      <PageHeader
        title="全部功能"
        description="按用途分组。先看组，再展开要用的一项；不把所有入口一次铺在首屏。"
      />

      <div className="divide-y border-y">
        {MOBILE_MORE_GROUP_ORDER.map((group) => {
          const groupItems = items.filter((item) => item.group === group)
          if (groupItems.length === 0) return null
          const open = Boolean(openGroups[group])
          return (
            <section key={group}>
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                aria-expanded={open}
                className="flex min-h-[52px] w-full items-center justify-between gap-3 py-3 text-left"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-medium">{group}</span>
                  <span className="rounded-full border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {groupItems.length}
                  </span>
                </span>
                <ChevronDown
                  className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
                />
              </button>

              {open ? (
                <div className="grid grid-cols-2 gap-2 pb-4">
                  {groupItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <Link
                        key={`${item.to}-${item.label}`}
                        to={item.to}
                        search={item.search}
                        className="flex min-h-[64px] items-center gap-2.5 rounded-xl border bg-card px-3 py-3 text-sm transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="line-clamp-2">{item.label}</span>
                      </Link>
                    )
                  })}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>

      {isAuthenticated ? (
        <Button
          variant="outline"
          className="w-full text-muted-foreground"
          onClick={() => void onLogout()}
          disabled={logoutMut.isPending}
        >
          <LogOut className="h-4 w-4" />
          退出登录
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button asChild>
            <Link to="/login">登录</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/register">注册</Link>
          </Button>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] leading-5 text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        这里只放次级入口；写、读、论坛、个人中心仍在底部固定栏。
      </p>
    </div>
  )
}
