/**
 * 检索词高亮：目录/列表只对标题做标记，摘要不动——中文学术标题里
 * 关键词往往就是检索词本身，标出来读者才知道为什么命中。
 * 用 <mark> 而不是包 span：浏览器自带的语义，屏幕阅读器也会念出强调。
 */
export function Highlight({ text, query }: { text: string; query?: string | null }) {
  const q = (query ?? '').trim()
  if (!q) return <>{text}</>

  // 大小写不敏感匹配；正则元字符转义，避免用户输入 “(” 把正则打崩。
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  if (parts.length === 1) return <>{text}</>

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}
