import { MarkdownContent } from '@/components/common/markdown-content'

/**
 * 论文排版预览（Studio 的“右侧那张纸”）。
 *
 * 和 ArticlePreview 的区别：ArticlePreview 预览的是“发布到网页后的样子”，
 * 这里预览的是“印成 PDF 后的样子”——A4 版心、刊名页眉、题录顺序
 * （标题/副标题/作者/单位/摘要/关键词/正文/页脚）、衬线正文与页码。
 * 与导出的 docx→LibreOffice 版式同一套题录顺序，作者在提交前就能发现
 * 标题过长、摘要缺字、关键词缺失这类问题。
 */
export interface PaperProofProps {
  title: string
  authors: string[]
  affiliations?: string
  abstract: string
  keywords: string[]
  body: string
  doi?: string
  funding?: string
  clc?: string
  license?: string
  /** 期刊分区：论文轨显示“第 x 页”样式页脚，副刊显示“副刊”。 */
  track?: 'paper' | 'essay'
}

/** 预览层剥掉正文里重复的标题/摘要/关键词，不改存储原文。 */
function stripFrontMatter(body: string, title: string): string {
  let md = body.trim()
  const first = md.match(/^#{1,6}\s+([^\n]+)\n+/)
  if (first && first[1].trim() === title.trim()) md = md.slice(first[0].length)
  md = md.replace(/^#{1,6}\s*(摘\s*要|Abstract)\s*\n[\s\S]*?(?=\n#{1,6}\s|$)/im, '')
  md = md.replace(/^#{1,6}\s*(关键词|关键字|Keywords?)\s*\n[\s\S]*?(?=\n#{1,6}\s|$)/im, '')
  return md.trim()
}

function splitTitle(title: string): { main: string; sub: string } {
  const parts = (title || '').split(/\s*——\s*/)
  return { main: parts[0] || '未填写标题', sub: parts.slice(1).join('——') }
}

export function PaperProof({
  title,
  authors,
  affiliations,
  abstract,
  keywords,
  body,
  doi,
  funding,
  clc,
  license,
  track = 'paper',
}: PaperProofProps) {
  const { main, sub } = splitTitle(title || '未填写标题')
  const cleanBody = stripFrontMatter(body, title)
  const chars = (abstract + cleanBody).replace(/\s/g, '').length
  const pages = Math.max(1, Math.ceil(chars / 1500))

  return (
    <div className="paper-proof">
      <div className="paper-proof-sheet">
        <div className="proof-running-head">
          <span>RUBBISH JOURNAL</span>
          <span>rubbish.argjiemi.cn</span>
        </div>

        <h1 className="paper-proof-title">{main}</h1>
        {sub ? <p className="paper-proof-subtitle">——{sub}</p> : null}

        <p className="paper-proof-authors">
          {authors.length > 0 ? authors.join('　') : '作者未填写'}
        </p>
        {affiliations?.trim() ? <p className="paper-proof-affs">{affiliations}</p> : null}
        {(doi || clc || funding) ? (
          <p className="paper-proof-affs">
            {[
              clc ? `中图分类号 ${clc}` : '',
              doi ? `DOI ${doi}` : '',
              funding ? `基金：${funding}` : '',
            ]
              .filter(Boolean)
              .join('　·　')}
          </p>
        ) : null}

        {abstract.trim() ? (
          <section className="paper-proof-block">
            <h2 className="mb-1 text-[11px] font-bold tracking-[0.22em] text-green-900">摘要</h2>
            <MarkdownContent text={abstract} className="paper-proof-text" />
          </section>
        ) : null}

        {keywords.length > 0 ? (
          <p className="paper-proof-keywords">
            <span className="font-semibold">关键词：</span>
            {keywords.join('；')}
          </p>
        ) : null}

        <div className="paper-proof-body">
          {cleanBody ? (
            <MarkdownContent text={cleanBody} className="paper-proof-text" />
          ) : (
            <p className="text-sm text-muted-foreground">还没有正文。</p>
          )}
        </div>

        <div className="paper-proof-foot">
          <span>
            {track === 'essay' ? '副刊 · 非论文格式' : '论文轨 · 学术排版'}
            {license ? ` · ${license}` : ''}
          </span>
          <span>
            第 1 页 / 共约 {pages} 页 · {chars} 字
          </span>
        </div>
      </div>
    </div>
  )
}
