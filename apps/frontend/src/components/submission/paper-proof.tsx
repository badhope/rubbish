import { useEffect, useId, useRef, useState } from 'react'
import { MarkdownContent } from '@/components/common/markdown-content'

/**
 * 论文排版预览（Studio 的“右侧那张纸”）。
 *
 * 和 ArticlePreview 的区别：ArticlePreview 预览的是“发布到网页后的样子”，
 * 这里预览的是“印成 PDF 后的样子”——A4 版心、刊名页眉、题录顺序
 * （标题/副标题/作者/单位/摘要/关键词/正文/页脚）。
 *
 * 分页交给 pagedjs：按 @page 规则真正切成 794×1123 的纸页，长段落会被
 * 拆到下一页，页码用 counter(page)/counter(pages) 生成——和最终 PDF 的
 * “第 x 页 / 共 n 页”一致，不再是无限拉长的网页。
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
  track?: 'paper' | 'essay'
  /** 有回调时工具条出现「下载 PDF」，由页面负责请求后端。 */
  onDownloadPdf?: () => void
  pdfBusy?: boolean
}

const PAGE_W = 794
const PAGE_H = 1123

/** 预览层剥掉正文里重复的标题/摘要/关键词，不改存储原文。 */
function stripFrontMatter(body: string, title: string): string {
  let md = body.trim()
  const first = md.match(/^#{1,6}\s+([^\n]+)\n+/)
  if (first && first[1].trim() === title.trim()) md = md.slice(first[0].length)
  md = md.replace(/^#{1,6}\s*(摘\s*要|Abstract)\s*\n[\s\S]*?(?=\n#{1,6}\s|$)/im, '')
  md = md.replace(/^#{1,6}\s*(关键词|关键字|Keywords?)\s*\n[\s\S]*?(?=\n#{1,6}\s|$)/im, '')
  return md.trim()
}


const AUTHOR_RE = /^([^0-9*]+?)\s*([0-9,，\s]*)(\*?)$/

/** 「张三1,2*」→ 姓名 + 上标 + 通讯标记；无数字时原样输出。 */
function renderAuthorLine(authors: string[]) {
  if (authors.length === 0) return '作者未填写'
  return authors.map((raw, i) => {
    const name = (raw || '').trim()
    const m = name.match(AUTHOR_RE)
    const nodes =
      m && (m[2].trim() || m[3]) ? (
        <>
          {m[1].trim()}
          {m[2].trim() ? <sup>{m[2].replace(/[，\s]+/g, ',').replace(/^,|,$/g, '')}</sup> : null}
          {m[3]}
        </>
      ) : (
        name
      )
    return (
      <span key={`${name}-${i}`}>
        {i > 0 ? '　' : ''}
        {nodes}
      </span>
    )
  })
}

/** 单位按行/分号拆开，逐条加上标序号。 */
function renderAffiliations(affiliations?: string) {
  const lines = (affiliations || '')
    .split(/[\n；;]+/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return null
  return lines.map((line, i) => (
    <span key={i}>
      {i > 0 ? <br /> : null}
      <sup>{i + 1}</sup> {line.replace(/^\s*[0-9]+[.、)]\s*/, '')}
    </span>
  ))
}

function splitTitle(title: string): { main: string; sub: string } {
  const parts = (title || '').split(/\s*——\s*/)
  return { main: parts[0] || '未填写标题', sub: parts.slice(1).join('——') }
}

function buildPageCss(): string {
  return `
@page {
  size: ${PAGE_W}px ${PAGE_H}px;
  margin: 50px 54px 46px;
}
`
}

/** pagedjs 的 @page margin box 在当前版本解析不到 content，渲染完手工补页眉页脚。 */
function decoratePages(root: HTMLElement, license: string, track: 'paper' | 'essay', chars: number) {
  const pages = Array.from(root.querySelectorAll<HTMLElement>('.pagedjs_page'))
  const total = pages.length
  const leftText = `${track === 'essay' ? '自由创作 · 非学术文章格式' : '研究文章 · 学术排版'}${
    license ? ` · ${license}` : ''
  }\u3000·\u3000${chars} 字`
  const set = (page: HTMLElement, corner: string, text: string, align: string) => {
    const box = page.querySelector<HTMLElement>(
      `.pagedjs_margin-${corner} .pagedjs_margin-content`,
    )
    if (!box) return
    box.textContent = text
    box.style.visibility = 'visible'
    box.style.height = '100%'
    box.style.lineHeight = '1.4'
    box.style.fontFamily = '"Noto Sans SC", "Source Han Sans SC", sans-serif'
    box.style.fontSize = '8.5px'
    box.style.color = '#6b7a6f'
    box.style.textAlign = align
  }
  pages.forEach((page, i) => {
    set(page, 'top-left', 'RUBBISH JOURNAL', 'left')
    set(page, 'top-right', 'rubbish.argjiemi.cn', 'right')
    set(page, 'bottom-left', leftText, 'left')
    set(page, 'bottom-right', `第 ${i + 1} 页 / 共 ${total} 页`, 'right')
  })
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
  onDownloadPdf,
  pdfBusy = false,
}: PaperProofProps) {
  const { main, sub } = splitTitle(title || '未填写标题')
  const cleanBody = stripFrontMatter(body, title)
  const chars = (abstract + cleanBody).replace(/\s/g, '').length
  const licenseText = license || ''
  /** 数组身份每次都变，用字符串做依赖，避免每次渲染都重排。 */
  const authorsKey = authors.join('|')
  const keywordsKey = keywords.join('|')

  const outerRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const statusId = `paper-proof-status-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const [scale, setScale] = useState(1)
  const [actualSize, setActualSize] = useState(false)
  const [pageCount, setPageCount] = useState(0)
  const [failed, setFailed] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // 按容器宽度把纸页整体缩放到可见宽度（右侧栏约 0.5，弹层接近 1:1）。
  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 16
      setScale(Math.max(0.35, Math.min(1, w / PAGE_W)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 真正的分页：pagedjs 读取隐藏源，按 @page 切成纸页后塞进 pagesRef。
  useEffect(() => {
    let cancelled = false
    let flow: { destroy?: () => void } | undefined
    const run = async () => {
      await document.fonts.ready
      if (cancelled || !sourceRef.current || !pagesRef.current) return
      try {
        const { Previewer } = await import('pagedjs')
        if (cancelled) return
        pagesRef.current.innerHTML = ''
        setRendered(false)
        // 克隆成游离 fragment 再交给 pagedjs：不碰 React 正在管的节点，
        // 也避免把页面祖先（html/body）带进流里。
        const fragment = document.createDocumentFragment()
        Array.from(sourceRef.current.children).forEach((child) => {
          fragment.appendChild(child.cloneNode(true))
        })
        const previewer = new Previewer()
        // pagedjs 把「字符串」当 URL 去 fetch；CSS 文本要放进对象里才会按原文解析。
        const result = await previewer.preview(
          fragment,
          [{ 'paper-proof.css': buildPageCss() }],
          pagesRef.current,
        )
        flow = result as { destroy?: () => void }
        if (!cancelled) {
          decoratePages(pagesRef.current, licenseText, track, chars)
          setPageCount(pagesRef.current.querySelectorAll('.pagedjs_page').length)
          setRendered(true)
          setFailed(false)
        }
      } catch (err) {
        // 分页失败时把原因留在控制台与提示里，页面回退为连续长纸，绝不空白。
        console.error('pagedjs failed', err)
        if (!cancelled) {
          setFailed(true)
          setErrorMsg(err instanceof Error ? err.message : String(err))
        }
      }
    }

    const timer = setTimeout(run, 260)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      try {
        flow?.destroy?.()
      } catch {
        /* pagedjs 清理失败不影响下一次重排 */
      }
    }
  }, [title, authorsKey, affiliations, abstract, keywordsKey, body, doi, funding, clc, licenseText, track, chars])

  return (
    <div
      className="paper-proof"
      ref={outerRef}
      role="region"
      aria-label="排版预览"
      aria-describedby={statusId}
    >
      <div className="paper-proof-toolbar">
        <span id={statusId}>
          纸张预览 · {pageCount > 0 ? `${pageCount} 页` : '排版中…'} · {chars} 字
        </span>
        <div className="flex items-center gap-2">
          {onDownloadPdf ? (
            <button
              type="button"
              className="paper-proof-zoom"
              onClick={onDownloadPdf}
              disabled={pdfBusy}
            >
              {pdfBusy ? '生成中…' : '下载 PDF'}
            </button>
          ) : null}
          <button
            type="button"
            className="paper-proof-zoom"
            onClick={() => setActualSize((v) => !v)}
          >
            {actualSize ? '适应宽度' : '原始大小'}
          </button>
        </div>
      </div>

      {/* 隐藏的排版源：pagedjs 从这里取内容，作者看到的纸页由它生成。 */}
      <div className="paper-proof-source" aria-hidden>
        <div ref={sourceRef}>
          <h1 className="paper-proof-title">{main}</h1>
          {sub ? <p className="paper-proof-subtitle">——{sub}</p> : null}
          <p className="paper-proof-authors">
            {renderAuthorLine(authors)}
          </p>
          {renderAffiliations(affiliations) ? (
            <p className="paper-proof-affs">{renderAffiliations(affiliations)}</p>
          ) : null}

          {abstract.trim() ? (
            <section className="paper-proof-block">
              <h2 className="paper-proof-abbr">开头</h2>
              <MarkdownContent text={abstract} className="paper-proof-text" />
            </section>
          ) : null}

          {keywords.length > 0 ? (
            <p className="paper-proof-keywords">
              <span className="font-semibold">话题：</span>
              {keywords.join('；')}
            </p>
          ) : null}

          <div className="paper-proof-text paper-proof-main">
            {cleanBody ? (
              <MarkdownContent text={cleanBody} className="paper-proof-text" />
            ) : (
              <p className="paper-proof-empty">还没有正文。</p>
            )}
          </div>
        </div>
      </div>

      <div
        className="paper-proof-pages-wrap"
        style={actualSize ? { overflowX: 'auto' } : undefined}
      >
        <div
          ref={pagesRef}
          className="paper-proof-pages"
          style={{
            // 分页测量必须在 1:1 下做；量完再把纸页缩到栏宽，避免缩小后“一页塞更多”。
            zoom: actualSize ? 1 : rendered ? scale : 1,
            visibility: rendered ? 'visible' : 'hidden',
          }}
        />
      </div>

      {failed ? (
        <>
          <div className="paper-proof-sheet paper-proof-flow">
            <div className="paper-proof-flow-head">
              <span>RUBBISH JOURNAL</span>
              <span>rubbish.argjiemi.cn</span>
            </div>
            <h1 className="paper-proof-title">{main}</h1>
            {sub ? <p className="paper-proof-subtitle">——{sub}</p> : null}
            <p className="paper-proof-authors">{renderAuthorLine(authors)}</p>
            {renderAffiliations(affiliations) ? (
              <p className="paper-proof-affs">{renderAffiliations(affiliations)}</p>
            ) : null}
              {abstract.trim() ? (
              <section className="paper-proof-block">
                <h2 className="paper-proof-abbr">开头</h2>
                <MarkdownContent text={abstract} className="paper-proof-text" />
              </section>
            ) : null}
            {keywords.length > 0 ? (
              <p className="paper-proof-keywords">
                <span className="font-semibold">话题：</span>
                {keywords.join('；')}
              </p>
            ) : null}
            <div className="paper-proof-text paper-proof-main">
              <MarkdownContent text={cleanBody} className="paper-proof-text" />
            </div>
          </div>
          <div className="paper-proof-fallback">
            分页组件未就绪（{errorMsg || '加载中'}），当前为连续长纸预览。
          </div>
        </>
      ) : null}
    </div>
  )
}
