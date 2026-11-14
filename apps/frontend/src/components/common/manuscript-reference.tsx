import { ManuscriptMarkdown } from "@/components/common/manuscript-render";

export function referenceEntries(refs: string): string[] {
  const body = refs.replace(/^#{1,6}[ \t]*参考文献[^\n]*\n?/i, "").trim();
  if (!body) return [];
  return body
    .split(/\n(?=[ \t]*\[\d+\])/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * 把正文里的 [1] / [1,3] 文献标记变成可点击跳转，并给参考文献逐条加锚点。
 * 只处理纯文本节点，跳过链接、代码、公式和参考文献区，避免重复包裹。
 */
export function enhanceCitations(
  root: HTMLElement,
  refCount: number,
  openRefs: (targetId: string) => void,
) {
  const section = root.querySelector<HTMLElement>("#refs .refs-body");
  if (!section) return;
  const entries = Array.from(section.querySelectorAll<HTMLElement>("p, li"));
  entries.forEach((entry, index) => {
    entry.id = `ref-${index + 1}`;
    entry.classList.add("md-ref-entry");
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => {
    const value = node.nodeValue ?? "";
    if (!/\[\d/.test(value) || !node.parentElement) return;
    if (
      node.parentElement.closest(
        "a, code, pre, .katex, #refs, script, style, button, input, textarea",
      )
    )
      return;
    const re =
      /\[(\d+(?:\s*[-,–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-,–]\s*\d+)?)*)\]/g;
    const fragment = document.createDocumentFragment();
    let last = 0;
    let matched = false;
    for (const match of value.matchAll(re)) {
      const first = Number(match[1].match(/\d+/)?.[0] ?? 0);
      if (first < 1 || first > refCount) continue;
      matched = true;
      fragment.append(value.slice(last, match.index));
      const anchor = document.createElement("a");
      anchor.href = `#ref-${first}`;
      anchor.className = "md-cite";
      anchor.dataset.cite = "1";
      anchor.textContent = match[0];
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        openRefs(`ref-${first}`);
      });
      fragment.append(anchor);
      last = (match.index ?? 0) + match[0].length;
    }
    if (!matched) return;
    fragment.append(value.slice(last));
    node.parentElement?.replaceChild(fragment, node);
  });
}

/**
 * 参考文献折叠区。条目锚点由 enhanceCitations 在正文渲染后补；
 * 这里只负责把 refs 原文按 [1]/[2] 分段，避免整段挤成一坨。
 */
export function ReferenceSection({
  entries,
  refCount,
  open,
  onToggle,
}: {
  entries: string[];
  refCount: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <details
      id="refs"
      className="refs-collapse mt-10 rounded-lg border bg-muted/30"
      open={open || undefined}
    >
      <summary
        className="cursor-pointer select-none px-4 py-3 text-sm font-medium"
        onClick={(event) => {
          event.preventDefault();
          onToggle();
        }}
      >
        参考文献（{refCount} 条）· 点击展开
      </summary>
      <div className="border-t px-4 py-3">
        <div className="markdown-body refs-body">
          <ManuscriptMarkdown math={false}>
            {entries.join("\n\n")}
          </ManuscriptMarkdown>
        </div>
      </div>
    </details>
  );
}
