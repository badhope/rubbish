import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { ResourceResponse } from '@/lib/types'
import { formatAuthors, cn } from '@/lib/utils'
import { isScholarlyContent } from '@/lib/resource-labels'
import { essayGenreLabel } from '@/lib/essay-genres'
import { DISCIPLINE_STYLE, DEFAULT_DISCIPLINE_STYLE } from '@/lib/discipline-style'
import { Highlight } from '@/components/common/highlight'

// 目录九宫格封面卡（v1.15）：一眼分轨道。
//
// 为什么是「文字徽标」而不是颜色小点：色弱/暗模式下纯颜色区分失效，
// 徽标里直接写「论文 / 娱乐」两个汉字，配合冷暖底色，第一屏就能分流。
//   - 论文：冷色/深色底（slate-900），信息行给 CLC + 学术年；
//   - 娱乐：暖色底（amber-500），信息行给「娱乐向/吐槽向」，绝不渲染空 CLC。
// 封面图缺失时用学科渐变底色 + 学科图标占位（DISCIPLINE_STYLE），
// 并对加载失败的图 onError 回退到同一占位——杜绝「破图」感。

interface CatalogGridCardProps {
  resource: ResourceResponse
  /** 当前检索词：只用于标题高亮，不参与筛选。 */
  query?: string
}

export function CatalogGridCard({ resource, query }: CatalogGridCardProps) {
  const scholarly = isScholarlyContent(resource.content_category, resource.content_track)
  const essay = resource.content_track === 'essay'
  const authors = formatAuthors(resource.authors)
  const style = DISCIPLINE_STYLE[resource.discipline] ?? DEFAULT_DISCIPLINE_STYLE
  const Icon = style.icon
  const preview = (resource.preview || resource.abstract || '')
    .replace(/[#>*_`~]/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const [coverBroken, setCoverBroken] = useState(false)

  return (
    <Link
      to="/catalog/$resourceId"
      params={{ resourceId: String(resource.id) }}
      className="card-lift group flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      {/* 封面区：封面图在上层，学科色块在底层兜底 */}
      <div className="catalog-cover relative w-full shrink-0 overflow-hidden">
        <div
          aria-hidden
          className={cn('absolute inset-0 bg-gradient-to-br', style.tint)}
        >
          <Icon className="absolute inset-0 m-auto h-10 w-10 text-foreground/20" />
        </div>
        {resource.cover_image && !coverBroken ? (
          <img
            src={resource.cover_image}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            onError={() => setCoverBroken(true)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : null}

        {/* 轨道文字徽标：左上，汉字 + 冷暖底色 + 描边，不靠颜色小点 */}
        <span
          className={cn(
            'absolute left-2 top-2 rounded-md border px-2 py-0.5 text-[10px] font-semibold leading-none shadow-sm backdrop-blur-sm sm:text-[11px]',
            essay
              ? 'border-rose-700/40 bg-rose-600/90 text-white'
              : scholarly
                ? 'border-slate-700/40 bg-slate-900/85 text-white'
                : 'border-amber-600/40 bg-amber-500/90 text-white',
          )}
        >
          {essay ? '副刊' : resource.track === 'absurd' ? '荒诞论文' : '学术论文'}
        </span>

        {resource.is_special_issue ? (
          <span
            className="absolute right-2 top-2 rounded-md border border-rose-200/60 bg-rose-50/90 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-rose-800 shadow-sm backdrop-blur-sm sm:px-2 sm:text-[11px]"
            title={resource.special_issue_reason ?? '篇幅特许收录'}
          >
            特别篇
          </span>
        ) : null}

        {/* 学科角标：封面左下角，辅助识别 */}
        {resource.discipline ? (
          <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
            {resource.discipline}
          </span>
        ) : null}
      </div>

      {/* 信息区：标题 + 一行轨道/学术元信息 + 摘要一句 + 作者 */}
      <div className="catalog-card-body flex flex-1 flex-col gap-1.5 p-2.5 sm:p-3">
        <p className="catalog-card-title line-clamp-2 text-[13px] font-medium leading-snug sm:text-sm">
          <Highlight text={resource.title} query={query} />
        </p>

        {scholarly ? (
          // 论文卡：CLC + 学术信息一行；没有 CLC 时只给学科/年，不渲染空占位
          <p className="line-clamp-1 text-[10px] text-muted-foreground sm:text-[11px]">
            {resource.clc_code ? `CLC ${resource.clc_code}` : resource.discipline}
            {resource.year ? ` · ${resource.year}` : ''}
          </p>
        ) : (
          // 副刊卡：文体必须在卡面出现，不能只写一个“副刊”
          <p className="line-clamp-1 text-[10px] text-muted-foreground sm:text-[11px]">
            {essayGenreLabel(resource.content_genre)}
            {resource.year ? ` · ${resource.year}` : ''}
          </p>
        )}

        {preview ? (
          <p className="line-clamp-2 text-[10px] leading-4 text-muted-foreground/80 sm:text-[11px] sm:leading-[1.35]">
            {preview}
          </p>
        ) : null}

        <p className="mt-auto line-clamp-1 pt-0.5 text-[10px] text-muted-foreground sm:text-[11px]">
          {authors || '佚名'}
        </p>
      </div>
    </Link>
  )
}
