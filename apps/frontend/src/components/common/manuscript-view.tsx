import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ALargeSmall, Baseline } from "lucide-react";
import "katex/dist/katex.min.css";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState, Loading } from "@/components/common/state";
import { useReadingPrefs } from "@/components/common/manuscript-reading-prefs";
import { ManuscriptMarkdown } from "@/components/common/manuscript-render";
import {
  enhanceCitations,
  ReferenceSection,
  referenceEntries,
} from "@/components/common/manuscript-reference";
import {
  collectToc,
  TOC_OPEN_EVENT,
  TocDrawer,
  TocSidebar,
  type TocEntry,
} from "@/components/common/manuscript-toc";
import {
  dedupeRepeatedParagraphs,
  dedupeRepeatedSentences,
  humanizeFunMarkdown,
  scrubManuscriptEmails,
  splitAbstract,
  splitManuscript,
  stripAcademicSections,
  stripHtmlComments,
  stripLeadingDuplicateAbstract,
} from "@/components/common/manuscript-text";

export type { TocEntry } from "@/components/common/manuscript-toc";
export { TOC_OPEN_EVENT } from "@/components/common/manuscript-toc";

// 在线阅读编排层：取数、清洗、目录、引用跳转、进度与阅读偏好。
// 纯文本预处理在 manuscript-text.ts，Markdown 渲染在 manuscript-render.tsx，
// 参考文献与目录各自独立，主文件只保留状态与阅读流程。

interface ManuscriptViewProps {
  resourceId: number;
  initialPercent: number;
  onProgress: (percent: number, completed: boolean) => void;
  /** true = 用 window 原生滚动采集进度（移动端富文本），false = 容器内滚 */
  useWindowScroll?: boolean;
  /** 目录条目数变化时回调，供阅读页决定底部「目录」按钮是否出现 */
  onTocChange?: (count: number) => void;
  /** 目录条目就绪时回调，供父级把 TOC 渲染到自己的侧栏 */
  onTocReady?: (toc: TocEntry[]) => void;
  /** 隐藏组件内置的左侧 TOC 导航（父级自己渲染侧栏时用） */
  hideTocNav?: boolean;
  /** 作品加载失败（含 409 needs_docx）时回调，父级可据此渲染兜底 UI */
  onFatalError?: (err: unknown) => void;
  /** 内容分类（来自资源元数据），组件内部据此计算 effectiveKind */
  contentCategory?: string | null;
  /** 内容赛道（essay/paper），作为 contentCategory 的兜底 */
  contentTrack?: string | null;
  /** 页面已展示的标题；用于剥掉正文首行重复标题 */
  title?: string;
  /** 页面已展示的概要/导读；用于剥掉正文开头重复的同一段 */
  abstract?: string | null;
}

export function ManuscriptView({
  resourceId,
  initialPercent,
  onProgress,
  useWindowScroll = false,
  onTocChange,
  onTocReady,
  hideTocNav = false,
  onFatalError,
  contentCategory,
  contentTrack,
  title,
  abstract,
}: ManuscriptViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const [scrollHost, setScrollHost] = useState<HTMLDivElement | null>(null);
  const [refsOpen, setRefsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  // 阅读偏好：字号/行距/衬线。toolbar 折叠收纳，不与目录按钮抢位。
  const { prefs, update: updatePrefs } = useReadingPrefs();
  // 手机端阅读设置默认收起，避免常驻工具条压住正文开头
  const [prefsOpen, setPrefsOpen] = useState(false);

  // 组件内部自行计算 effectiveKind：以 content_category 为准，content_track=essay 兜底。
  // 不依赖外部一次性传值，避免父组件漏传导致裁剪不生效。
  const effectiveKind: "paper" | "sci_pop" | "fun" | "rant" | "plain" = (() => {
    const cat = (contentCategory ?? "").toLowerCase();
    if (cat === "fun") return "fun";
    if (cat === "rant") return "rant";
    if (
      cat === "science" ||
      cat === "science_pop" ||
      cat === "popular" ||
      cat === "scipop" ||
      cat === "科普"
    )
      return "sci_pop";
    if (cat === "academic" || cat === "paper") return "paper";
    if (contentTrack === "essay") return "fun"; // 兜底：essay 一律按娱乐处理
    return "paper";
  })();

  // 底部操作栏的「目录」按钮通过 window 事件唤出抽屉：目录条目是在
  // 本组件里从 Markdown 解析出来的，把状态提上去反而要重解析一遍。
  useEffect(() => {
    const onOpen = () => setTocOpen(true);
    window.addEventListener(TOC_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(TOC_OPEN_EVENT, onOpen);
  }, []);

  const {
    data,
    isLoading,
    isError,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ["catalog", "manuscript", resourceId],
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: async () => {
      const resp = await api.get<string>(`/catalog/${resourceId}/manuscript`, {
        transformResponse: (body) => body,
        headers: { Accept: "text/markdown" },
      });
      return resp.data;
    },
  });

  // 渲染前剥离 Word 转换残留的 HTML 注释（只在渲染层，不改存储原文）。
  // 自由创作不渲染研究小节；原稿里的邮箱一律脱敏。
  // 兜底：若 effectiveKind=paper 但原稿以 Open Access 开头（说明 content_category 没标对），
  // 强制走 fun 分支剥刊头。
  const cleaned = (() => {
    if (!data) return data;
    let kind = effectiveKind;
    if (kind === "paper" && /^Open Access/i.test(data.trim())) kind = "fun";
    const stripped = stripAcademicSections(
      stripHtmlComments(data),
      kind,
      title,
    );
    const humanized =
      kind === "fun" || kind === "rant"
        ? humanizeFunMarkdown(stripped)
        : stripped;
    const deduped =
      kind === "fun" || kind === "rant"
        ? stripLeadingDuplicateAbstract(humanized, abstract)
        : humanized;
    const noRepeat =
      kind === "fun" || kind === "rant"
        ? dedupeRepeatedParagraphs(deduped)
        : deduped;
    const noRepeatSentence =
      kind === "fun" || kind === "rant"
        ? dedupeRepeatedSentences(noRepeat)
        : noRepeat;
    return scrubManuscriptEmails(noRepeatSentence);
  })();

  // 目录与正文/参考文献拆分：纯字符串操作，无需 memo
  const split = cleaned ? splitManuscript(cleaned) : { main: "", refs: "" };
  const sections = split.main
    ? splitAbstract(split.main)
    : { before: "", abstract: "", label: "摘要", after: "" };
  const main = split.main;
  const refs = split.refs;
  const refEntries = refs ? referenceEntries(refs) : [];
  const refCount = refEntries.length;
  const [toc, setToc] = useState<TocEntry[]>([]);
  const articleRef = useRef<HTMLElement>(null);
  const onTocReadyRef = useRef(onTocReady);
  useEffect(() => {
    onTocReadyRef.current = onTocReady;
  }, [onTocReady]);
  useEffect(() => {
    if (!data || !articleRef.current) return;
    const entries = collectToc(articleRef.current, Boolean(refs));
    setToc(entries);
    onTocReadyRef.current?.(entries);
  }, [data, refs]);

  // 文献引用跳转：正文 [1] 点击后展开参考文献并滚到对应条目。
  useEffect(() => {
    const root = articleRef.current;
    if (!root || !refCount) return;
    const openRefs = (targetId: string) => {
      setRefsOpen(true);
      const align = () => {
        const target = document.getElementById(targetId);
        if (!target) return;
        if (useWindowScroll) {
          window.scrollTo({
            top: target.getBoundingClientRect().top + window.scrollY - 88,
          });
        } else if (scrollRef.current) {
          const host = scrollRef.current;
          host.scrollTop =
            target.getBoundingClientRect().top -
            host.getBoundingClientRect().top +
            host.scrollTop -
            88;
        }
      };
      // <details> 展开与懒加载图片会继续改变文档高度，分几次对齐，
      // 保证最终落点仍在目标文献，而不是半路被撑开。
      window.requestAnimationFrame(() => window.requestAnimationFrame(align));
      window.setTimeout(align, 350);
      window.setTimeout(align, 1000);
    };
    enhanceCitations(root, refCount, openRefs);
  }, [data, refCount, refsOpen, useWindowScroll]);

  useEffect(() => {
    if (isError) onFatalError?.(queryError);
  }, [isError, queryError, onFatalError]);

  // 超宽条图适配：宽高比 ≥ 4 的图（常见于从 PDF 里裁出来的一行公式截图），
  // 按 100% 宽度等比缩放后在 390px 的手机上只剩十几像素高，字迹完全糊掉。
  // 这里把这类图包进可横向滚动的容器，按可读宽度展示。
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const wrapWide = () => {
      root
        .querySelectorAll<HTMLImageElement>("img:not([data-wide])")
        .forEach((img) => {
          const mark = () => {
            if (!img.naturalWidth || !img.naturalHeight) return;
            if (img.naturalWidth / img.naturalHeight < 4) return;
            if (img.closest(".md-wide-figure")) return;
            img.dataset.wide = "1";
            const box = document.createElement("div");
            box.className = "md-wide-figure";
            img.parentNode?.insertBefore(box, img);
            box.appendChild(img);
            const hint = document.createElement("span");
            hint.className = "md-wide-figure__hint";
            hint.textContent = "左右滑动查看完整图片";
            box.parentNode?.insertBefore(hint, box.nextSibling);
          };
          if (img.complete) mark();
          else img.addEventListener("load", mark, { once: true });
        });
    };
    wrapWide();
    const timer = window.setTimeout(wrapWide, 400);
    return () => window.clearTimeout(timer);
  }, [data, refsOpen]);

  // 目录条目数上报给阅读页：不足 3 条时底部不出现「目录」按钮，
  // 避免按下去弹出一个几乎空白的抽屉。
  useEffect(() => {
    onTocChange?.(toc.length);
  }, [toc.length, onTocChange]);

  // 进入时按已保存的百分比恢复阅读位置（本地或服务端进度）。
  // 恢复是一次性副作用：走 timeout 异步执行（react-hooks 编译规则要求
  // render 后的变更一律异步），restoredRef 保证只恢复一次。
  useEffect(() => {
    if (!data || !scrollHost) return;
    const timer = window.setTimeout(() => {
      if (restoredRef.current) return;
      restoredRef.current = true;
      if (initialPercent > 0) {
        if (useWindowScroll) {
          const max =
            document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo(0, (initialPercent / 100) * max);
        } else {
          const max = scrollHost.scrollHeight - scrollHost.clientHeight;
          scrollHost.scrollTop = (initialPercent / 100) * max;
        }
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [data, scrollHost, initialPercent, useWindowScroll]);

  // 进度采集：移动端富文本走 window 原生滚动，桌面/内滚走容器滚动
  useEffect(() => {
    if (!useWindowScroll) return;
    const onWinScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const percent =
        max <= 0
          ? 100
          : Math.min(100, Math.round((window.scrollY / max) * 100));
      onProgress(percent, percent >= 98);
    };
    window.addEventListener("scroll", onWinScroll, { passive: true });
    return () => window.removeEventListener("scroll", onWinScroll);
  });

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const percent =
      max <= 0 ? 100 : Math.min(100, Math.round((el.scrollTop / max) * 100));
    onProgress(percent, percent >= 98);
  };

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (useWindowScroll) {
      const top = el.getBoundingClientRect().top + window.scrollY - 88;
      window.scrollTo({ top });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = el.offsetTop - 24;
    }
    if (id === "refs") setRefsOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto">
        <Loading />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
        <EmptyState
          title="在线作品加载失败"
          description="这份记录没有可用的在线正文，请切换到 PDF 视图或直接下载。"
          action={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              重试
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div
      ref={(node) => {
        scrollRef.current = node;
        setScrollHost(node);
      }}
      onScroll={useWindowScroll ? undefined : handleScroll}
      className={
        "flex-1 bg-background " + (useWindowScroll ? "" : "overflow-y-auto")
      }
    >
      {/* 手机上左右各留 14px：390pt 屏里正文行宽从 350 → 362，
          每行多容纳约 1.5 个汉字，长文读起来明显不挤。 */}
      <div className="mx-auto flex max-w-6xl items-start px-3.5 py-6 sm:px-5 sm:py-8">
        {/* 目录：桌面端左侧吸附；移动端底部抽屉，由阅读页操作栏的
            「目录」按钮通过 TOC_OPEN_EVENT 唤出（见下方 useEffect）。 */}
        {toc.length > 2 && (
          <TocDrawer
            toc={toc}
            open={tocOpen}
            onClose={() => setTocOpen(false)}
            onJump={jumpTo}
          />
        )}

        {toc.length > 2 && !hideTocNav && (
          <TocSidebar toc={toc} onJump={jumpTo} />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* 阅读控制条：字号 / 行距 / 衬线切换。
            桌面端常驻右上；手机端折叠成一颗小圆钮——390px 宽的屏上，
            一条常驻工具条会压住摘要开头，读者第一眼先看到一排图标而不是正文。
            容器用正常流占位（不再用负 margin 上提）：上提会让圆钮压在
            摘要卡右上角的边框上，看着像脱层。 */}
          <div className="sticky top-2 z-10 mb-1 flex justify-end">
            <button
              type="button"
              aria-label="阅读设置"
              aria-expanded={prefsOpen}
              onClick={() => setPrefsOpen((v) => !v)}
              className="mr-1 grid h-8 w-8 place-items-center rounded-full border bg-background/90 text-xs shadow-sm backdrop-blur lg:hidden"
            >
              Aa
            </button>
            <div
              className={`${prefsOpen ? "flex" : "hidden"} items-center gap-1 rounded-full border bg-background/95 px-2 py-1 shadow-sm backdrop-blur lg:flex`}
            >
              <button
                aria-label="减小字号"
                className="grid h-7 w-7 place-items-center rounded-full text-xs hover:bg-muted"
                onClick={() =>
                  updatePrefs({
                    fontScale: Math.max(0.85, prefs.fontScale - 0.08),
                  })
                }
              >
                <ALargeSmall className="h-4 w-4" />
              </button>
              <button
                aria-label="增大字号"
                className="grid h-7 w-7 place-items-center rounded-full text-base hover:bg-muted"
                onClick={() =>
                  updatePrefs({
                    fontScale: Math.min(1.5, prefs.fontScale + 0.08),
                  })
                }
              >
                <ALargeSmall className="h-5 w-5" />
              </button>
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
              <button
                aria-label="切换行距"
                className="grid h-7 w-7 place-items-center rounded-full hover:bg-muted"
                title={`行距 ${prefs.lineHeight.toFixed(2)}（点击在 1.6/1.95/2.3 间切换）`}
                onClick={() => {
                  const steps = [1.6, 1.95, 2.3];
                  const idx = steps.findIndex(
                    (v) => Math.abs(v - prefs.lineHeight) < 0.01,
                  );
                  updatePrefs({ lineHeight: steps[(idx + 1) % steps.length] });
                }}
              >
                <Baseline className="h-4 w-4" />
              </button>
              <span className="mx-0.5 h-4 w-px bg-border" aria-hidden="true" />
              <button
                className="rounded-full px-2 py-0.5 text-xs hover:bg-muted"
                title="切换正文字体（衬线/无衬线）"
                onClick={() => updatePrefs({ serif: !prefs.serif })}
              >
                {prefs.serif ? "衬线" : "无衬线"}
              </button>
            </div>
          </div>
          <article
            ref={articleRef}
            data-content-kind={effectiveKind}
            className="markdown-body min-w-0 flex-1"
            style={{
              fontSize: `${prefs.fontScale}em`,
              lineHeight: prefs.lineHeight,
              fontFamily: prefs.serif
                ? undefined
                : "ui-sans-serif, system-ui, 'Noto Sans SC', sans-serif",
            }}
          >
            {sections.abstract ? (
              <>
                {sections.before && (
                  <ManuscriptMarkdown>{sections.before}</ManuscriptMarkdown>
                )}
                <section
                  role="region"
                  aria-label={sections.label}
                  className="md-abstract"
                >
                  <ManuscriptMarkdown>
                    {`## ${sections.label}\n\n${sections.abstract}`}
                  </ManuscriptMarkdown>
                </section>
                {sections.after && (
                  <ManuscriptMarkdown>{sections.after}</ManuscriptMarkdown>
                )}
              </>
            ) : (
              <ManuscriptMarkdown>{main}</ManuscriptMarkdown>
            )}

            {refs && (
              <ReferenceSection
                entries={refEntries}
                refCount={refCount}
                open={refsOpen}
                onToggle={() => setRefsOpen((value) => !value)}
              />
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
