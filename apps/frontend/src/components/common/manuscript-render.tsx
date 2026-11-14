import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import {
  markdownSanitizeSchema,
  markdownUrlTransform,
  remarkCjkStrong,
} from "@/components/common/markdown-content";

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return nodeText(node.props.children);
  return "";
}

const CAPTION_TEXT = /^(?:图|表|Figure|Fig\.?|Table)[ \t\u3000]*\d+/i;
const KEYWORDS_TEXT = /^(?:关键词|关键字|Keywords?)[ \t]*[:：]/i;

// 图注/表注：整段为一行、且源稿用斜体或粗体标记（`*图 1 …*` / `**表 1 …**`）。
function paragraphClass(children: ReactNode): string | undefined {
  const text = nodeText(children).trim();
  if (KEYWORDS_TEXT.test(text)) return "md-keywords";
  if (!CAPTION_TEXT.test(text)) return undefined;
  const items = Children.toArray(children);
  const only = items.length === 1 ? items[0] : null;
  const emphasized =
    isValidElement(only) && (only.type === "em" || only.type === "strong");
  // 无强调标记时只认「图 1 / 表 1：」这种带全角分隔的独立短行，
  // 避免把「图 1 显示…」这类正文句子误判成图注。
  const labelled =
    /^(?:图|表)[ \t\u3000]*\d+[\u3000.、:：]/.test(text) && text.length <= 90;
  if (!emphasized && !labelled) return undefined;
  return /^(?:表|Table)/i.test(text)
    ? "md-caption md-caption-table"
    : "md-caption md-caption-figure";
}

// 公式/插图原图 404 时，浏览器会把 img 的 alt（整段 LaTeX 回退文本）
// 当正文渲染出来，看起来像"一堆乱码"（生产 /reader/133 实锤）。
// onError 后换成小占位元素：保留 a11y 信息，但不显示 alt 原文。
function ManuscriptImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);

  useEffect(() => {
    if (!zoomOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [zoomOpen]);

  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt || "图示"}
        className="md-img-missing my-5 flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border/70 bg-[repeating-linear-gradient(135deg,transparent_0,transparent_7px,color-mix(in_oklab,var(--color-muted)_35%,transparent)_7px,color-mix(in_oklab,var(--color-muted)_35%,transparent)_8px)] px-4 py-8 text-center"
      >
        <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground/70">
          RUBBISH · FIGURE
        </span>
        <span className="text-xs text-muted-foreground">图示未随稿附上</span>
      </span>
    );
  }
  return (
    <>
      <img
        src={src}
        alt={alt || "稿件插图"}
        loading="lazy"
        decoding="async"
        className="md-image-zoom"
        role="button"
        tabIndex={0}
        title="点击查看原图"
        onClick={() => setZoomOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setZoomOpen(true);
          }
        }}
        onError={() => setFailed(true)}
      />
      {zoomOpen
        ? createPortal(
            <div
              className="md-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={alt || "查看大图"}
              onClick={() => setZoomOpen(false)}
            >
              <img
                src={src}
                alt={alt || "稿件插图"}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="md-lightbox-close"
                onClick={() => setZoomOpen(false)}
              >
                关闭
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// 中文出版符号在阅读页也要「看得出是什么」：书名号走霞鹜文楷 + 品牌绿，
// 中文引号走霞鹜文楷；与 Word 下载件的 docx_template._add_inline 口径一致。
// 只处理文本节点，KaTeX / 图片等结构化节点原样放行，避免破坏公式。
const CN_INLINE_TOKENS = /(《[^》]{1,80}》|「[^」]{1,80}」|“[^”]{1,80}”)/g;

function decorateInline(nodes: ReactNode): ReactNode {
  return Children.map(nodes, (node) => {
    if (typeof node === "string") {
      const parts = node.split(CN_INLINE_TOKENS);
      if (parts.length === 1) return node;
      return parts.map((part, idx) => {
        if (!part) return null;
        if (part.startsWith("《")) {
          return (
            <span key={idx} className="md-book-title">
              {part}
            </span>
          );
        }
        if (part.startsWith("「") || part.startsWith("“")) {
          return (
            <span key={idx} className="md-quote-cn">
              {part}
            </span>
          );
        }
        return <Fragment key={idx}>{part}</Fragment>;
      });
    }
    if (isValidElement<{ children?: ReactNode; className?: string }>(node)) {
      const { children, className } = node.props;
      if (children === undefined || children === null) return node;
      if (typeof className === "string" && className.includes("katex"))
        return node;
      return cloneElement(node, undefined, decorateInline(children));
    }
    return node;
  });
}

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    // 空/非字符串 src（例如转换失败的本地绝对路径被清洗成空串）
    // 直接不渲染：浏览器对 src="" 会重新请求整页，且控制台报错。
    typeof src === "string" && src ? (
      <ManuscriptImage src={src} alt={alt ?? ""} />
    ) : null,
  p: ({ children }) => (
    <p className={paragraphClass(children)}>{decorateInline(children)}</p>
  ),
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

export function ManuscriptMarkdown({
  children,
  math = true,
}: {
  children: string;
  math?: boolean;
}) {
  return (
    <ReactMarkdown
      urlTransform={markdownUrlTransform}
      remarkPlugins={
        math
          ? [remarkGfm, remarkCjkStrong, remarkMath]
          : [remarkGfm, remarkCjkStrong]
      }
      rehypePlugins={
        math
          ? [
              rehypeRaw,
              [rehypeSanitize, markdownSanitizeSchema],
              [rehypeKatex, { strict: false }],
            ]
          : [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]
      }
      components={markdownComponents}
    >
      {children}
    </ReactMarkdown>
  );
}
