import { cn } from '@/lib/utils'

// 生成式封面：每篇记录根据 id/title 哈希得到一对互补色相，渲染成
// 带衬线首字的纸面卡片。零图片资源、零布局抖动（宽高比锁定 4:3），
// 同一篇的封面永远一致（服务端没有封面图字段，也不需要）。

function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const COVER_PALETTES = [
  'linear-gradient(135deg, oklch(0.93 0.05 75), oklch(0.85 0.09 55))',
  'linear-gradient(135deg, oklch(0.92 0.04 273), oklch(0.83 0.08 293))',
  'linear-gradient(135deg, oklch(0.94 0.03 150), oklch(0.86 0.07 170))',
  'linear-gradient(135deg, oklch(0.93 0.04 20), oklch(0.86 0.08 0))',
  'linear-gradient(135deg, oklch(0.92 0.05 210), oklch(0.85 0.08 240))',
  'linear-gradient(135deg, oklch(0.95 0.03 330), oklch(0.88 0.06 310))',
]

interface CoverArtProps {
  seed: number | string
  title: string
  subtitle?: string
  className?: string
}

export function CoverArt({ seed, title, subtitle, className }: CoverArtProps) {
  const h = hashString(`${seed}:${title}`)
  const palette = COVER_PALETTES[h % COVER_PALETTES.length]
  const tilt = ((h >> 8) % 5) - 2
  const initial = (title.trim()[0] ?? 'R').toUpperCase()

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative flex aspect-[4/3] w-full select-none items-center justify-center overflow-hidden rounded-lg border border-black/5',
        className,
      )}
      style={{ background: palette }}
    >
      <span
        className="font-serif text-6xl font-bold text-black/20 sm:text-7xl"
        style={{ transform: `rotate(${tilt}deg)` }}
      >
        {initial}
      </span>
      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/25 to-transparent p-2 text-[10px] font-medium tracking-wide text-white/90">
        <span className="line-clamp-1">{subtitle ?? 'Rubbish'}</span>
        <span className="shrink-0 opacity-60" aria-hidden>
          {String(h % 7 + 1).padStart(2, '0')}
        </span>
      </span>
    </div>
  )
}
