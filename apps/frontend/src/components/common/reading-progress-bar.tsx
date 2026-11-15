import { useEffect, useState } from 'react'

/**
 * 顶部阅读进度条：只在长文页启用。
 *
 * 同时兼容两种滚动容器——移动端富文本用 window 原生滚动，
 * 桌面端用内层 overflow 容器；取两者的较大值，避免其中一个不动时进度条冻结。
 */
export function ReadingProgressBar({ enabled = true }: { enabled?: boolean }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let raf = 0

    const compute = () => {
      raf = 0
      const doc = document.documentElement
      const winMax = doc.scrollHeight - window.innerHeight
      const winPct = winMax > 0 ? window.scrollY / winMax : 0

      let boxPct = 0
      const box = document.querySelector<HTMLElement>('[data-reader-scroll]')
      if (box) {
        const max = box.scrollHeight - box.clientHeight
        boxPct = max > 0 ? box.scrollTop / max : 0
      }
      const pct = Math.max(winPct, boxPct)
      setProgress(Math.min(100, Math.max(0, pct * 100)))
    }

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute)
    }

    compute()
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <div
      className="reading-progress"
      style={{ width: `${progress}%` }}
      role="progressbar"
      aria-label="阅读进度"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
    />
  )
}
