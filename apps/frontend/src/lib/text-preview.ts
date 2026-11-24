/**
 * 把 Markdown 正文压成一行可读摘要：去掉图片、链接、代码、表格管道和
 * 强调符号。论坛正文可能以 `![图片](/api/media/images/...)` 开头，直接
 * slice 会把 64 位文件名塞进卡片并撑坏布局。
 */
export function plainTextPreview(value: string | null | undefined, max = 160): string {
  const text = (value ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/^[>#]+\s*/gm, '')
    .replace(/[\\*_~]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  return `${text.slice(0, max).trimEnd()}…`
}
