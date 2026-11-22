import { useEffect, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ArrowRight, Compass, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'

const KEY = 'rubbish.onboarding.v2'

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

  // 不在表单和后台这些“正在办事”的页面弹浮层：
  // 用户此刻要看输入框和按钮，引导卡不能压住正文。
  const meSettings =
    location.pathname === '/me' &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('tab') === 'settings'
  const busy =
    meSettings ||
    ['/admin', '/editor', '/submissions/new', '/review', '/login', '/register'].some(
      (prefix) => location.pathname === prefix || location.pathname.startsWith(prefix + '/'),
    )
  if (!open || busy) return null

  const steps = [
    {
      title: '先认一下六个入口',
      body: '首页看全站，内容放长文，合集顺着读，讨论用来说话，怎么用有地图，我的放自己的东西。找不到就点「怎么用」。',
      to: '/guide',
      label: '打开怎么用',
    },
    {
      title: '三分钟走一遍',
      body: '「三分钟，先走一遍」里有四步入口和全站地图，第一次来照着走一遍就不会迷路。',
      to: '/guide',
      label: '开始上手',
    },
    {
      title: isAuthenticated ? '想发东西，先分清长短' : '登录后就能发',
      body: '一两句话，去「讨论」；完整长文，去「发布作品」。都能先存草稿，不申请资格，也不收钱。',
      to: isAuthenticated ? '/forum' : '/login',
      label: isAuthenticated ? '去讨论区' : '去登录',
    },
    {
      title: '边界先看清',
      body: '这里不做学术评价，也不出具发表、职称或学分证明；虚构要标注，真人隐私不碰。',
      to: '/about',
      label: '看站点性质',
    },
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
        <Button variant="ghost" size="sm" onClick={close}>下次再说</Button>
        <div className="flex gap-2">
          <Link to={current.to} onClick={close}><Button variant="outline" size="sm">{current.label}</Button></Link>
          {step < steps.length - 1 ? <Button size="sm" onClick={() => setStep(step + 1)}>下一步 <ArrowRight className="h-3.5 w-3.5" /></Button> : <Button size="sm" onClick={close}>知道了</Button>}
        </div>
      </div>
    </div>
  )
}
