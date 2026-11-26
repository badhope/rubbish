import { ListTree } from "lucide-react";
import { headingHash } from "@/components/common/manuscript-text";

export const TOC_OPEN_EVENT = "rubbish:open-toc";

export interface TocEntry {
  id: string;
  level: 2 | 3;
  text: string;
}

/**
 * 从渲染后的 article 里采集 h2/h3，跳过参考文献区；重复标题追加 `-x`
 * 保证锚点唯一。参考文献作为最后一个 h2 条目补进去。
 */
export function collectToc(root: HTMLElement, hasRefs: boolean): TocEntry[] {
  const seen = new Set<string>();
  const entries: TocEntry[] = [];
  root.querySelectorAll<HTMLHeadingElement>("h2, h3").forEach((heading) => {
    if (heading.closest("#refs")) return;
    const text = heading.textContent?.trim() ?? "";
    let id = `h-${headingHash(text)}`;
    while (seen.has(id)) id += "-x";
    seen.add(id);
    heading.id = id;
    entries.push({ id, level: heading.tagName === "H2" ? 2 : 3, text });
  });
  if (hasRefs) entries.push({ id: "refs", level: 2, text: "参考文献" });
  return entries;
}

export function TocDrawer({
  toc,
  open,
  onClose,
  onJump,
}: {
  toc: TocEntry[];
  open: boolean;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      role="dialog"
      aria-label="文章目录"
    >
      <button
        aria-label="关闭目录"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-2xl bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <ListTree className="h-4 w-4" />
            文章目录
          </p>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            关闭
          </button>
        </div>
        <ul className="space-y-0.5">
          {toc.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => {
                  onClose();
                  window.setTimeout(() => onJump(item.id), 120);
                }}
                className={
                  "block w-full truncate rounded px-2 py-2 text-left text-sm hover:bg-muted hover:text-primary " +
                  (item.level === 3
                    ? "pl-6 text-muted-foreground"
                    : "font-medium")
                }
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function TocSidebar({
  toc,
  onJump,
}: {
  toc: TocEntry[];
  onJump: (id: string) => void;
}) {
  return (
    <nav
      aria-label="文章目录"
      className="sticky top-0 hidden w-52 shrink-0 lg:mr-6 lg:block"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground">
        <ListTree className="h-3.5 w-3.5" />
        目录
      </p>
      <ul className="mt-2 max-h-[70dvh] space-y-0.5 overflow-y-auto border-l border-border pr-2 text-sm">
        {toc.map((item) => (
          <li key={item.id}>
            <button
              onClick={() => onJump(item.id)}
              className={
                "block w-full truncate rounded px-2 py-1 text-left text-xs transition-colors hover:bg-muted hover:text-primary " +
                (item.level === 3
                  ? "pl-5 text-muted-foreground"
                  : "font-medium")
              }
              title={item.text}
            >
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
