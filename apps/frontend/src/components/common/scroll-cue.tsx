import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// 封面屏到目录之间的“过渡针”：一条发丝线 + 下箭头。
// 它不是装饰卡片，只负责把读者的视线从标题带到下方内容。
export function ScrollCue({
  label = '向下浏览',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      aria-hidden
      className={cn('flex flex-col items-center gap-2.5 text-muted-foreground/75', className)}
    >
      <span className="h-12 w-px bg-gradient-to-b from-transparent via-border to-border sm:h-16" />
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-background/60">
        <ChevronDown className="scroll-cue-arrow h-4 w-4" />
      </span>
      <span className="text-[10px] uppercase tracking-[0.28em]">{label}</span>
    </div>
  )
}
