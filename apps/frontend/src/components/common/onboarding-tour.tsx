import { useEffect, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ArrowRight, Compass, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'

const KEY = 'rubbish.onboarding.v1'

/** 首次使用手把手引导：可跳过，只在本机显示一次。 */
export function OnboardingTour() {
  const { isAuthenticated } = useAuth()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const location = useLocation()

  useEffect(() => {
    try { setOpen(localStorage.getItem(KEY) !== 'done') } catch { /* 隐私模式下忽略 */ }
  }, [])

  const close = () => { try { localStorage.setItem(KEY, 'done') } catch { /* ignore */ } setOpen(false) }

  // 不在设置、后台这些“正在办事”的页面弹浮层：
  // 用户此刻要看表单和按钮，引导卡不能压住正文。
  const busy = ['/settings', '/admin', '/account']
    .some((prefix) => location.pathname === prefix || location.pathname.startsWith(prefix + '/'))
  if (!open || busy) return null

  const steps = [
    { title: '先看六个入口', body: '顶部固定 首页 / 社区 / 文章 / 等级 / 指南 / 我的。短帖在社区，文章按卷期归档；等级只看活跃，身份看权限。', to: '/forum', label: '去社区' },
    { title: isAuthenticated ? '写下你的第一篇文章' : '注册后就能写', body: '文章走投稿与审核，可先存草稿；短帖才发在社区。不用申请资格，也不收积分。', to: '/submissions/new', label: isAuthenticated ? '写文章' : '去登录' },
    { title: '把边界看清楚', body: '虚构要标注，材料要能对上，真人隐私不碰；其余交给社区讨论。', to: '/guide', search: { tab: 'policies' }, label: '看社区公约' },
  ]
  const current = steps[Math.min(step, steps.length - 1)]

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="fixed bottom-[calc(9rem+env(safe-area-inset-bottom))] left-3 z-[70] sm:left-auto sm:right-6 sm:bottom-20 inline-flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur transition-colors hover:bg-muted"
        aria-label="打开新手指引"
      >
        <Compass className="h-3.5 w-3.5" />
        新手指引
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {step + 1}/{steps.length}
        </span>
      </button>
    )
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-[80] rounded-xl border bg-background p-4 shadow-xl sm:inset-x-auto sm:right-6 sm:bottom-20 sm:w-80">
      <button className="absolute right-3 top-3 text-muted-foreground" onClick={close} aria-label="关闭引导"><X className="h-4 w-4" /></button>
      <p className="text-xs text-muted-foreground">首次使用 · {step + 1}/{steps.length}</p>
      <h3 className="mt-1 text-base font-semibold">{current.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{current.body}</p>
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={close}>跳过引导</Button>
        <div className="flex gap-2">
          <Link to={current.to} search={current.search} onClick={close}><Button variant="outline" size="sm">{current.label}</Button></Link>
          {step < steps.length - 1 ? <Button size="sm" onClick={() => setStep(step + 1)}>下一步 <ArrowRight className="h-3.5 w-3.5" /></Button> : <Button size="sm" onClick={close}>开始使用</Button>}
        </div>
      </div>
    </div>
  )
}
