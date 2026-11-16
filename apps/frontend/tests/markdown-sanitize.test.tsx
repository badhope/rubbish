import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownContent } from '@/components/common/markdown-content'

// L1 回归：清洗白名单既保留排版/公式，又挡住任意 className 注入与 DOM clobbering。
function html(text: string): HTMLElement {
  const { container } = render(<MarkdownContent text={text} />)
  return container
}

describe('markdownSanitizeSchema', () => {
  it('保留代码块的语言类（language-*）', () => {
    const c = html('```python\nprint(1)\n```')
    const code = c.querySelector('code')
    expect(code?.className).toContain('language-python')
  })

  it('剥掉任意注入的 className（防 Tailwind 工具类 UI 红披）', () => {
    const c = html('<span class="fixed inset-0 z-50 evil">hi</span>')
    expect(c.querySelector('.evil')).toBeNull()
    expect(c.querySelector('.fixed')).toBeNull()
    expect(c.textContent).toContain('hi')
  })

  it('id 被 clobberPrefix 前缀化，防 DOM clobbering', () => {
    const c = html('<div id="alert">x</div>')
    expect(c.querySelector('[id="alert"]')).toBeNull()
    expect(c.querySelector('[id="user-content-alert"]')).not.toBeNull()
  })

  it('行内公式仍渲染为 KaTeX', () => {
    const c = html('质能方程 $x^2$ 结束')
    expect(c.querySelector('.katex')).not.toBeNull()
  })

  it('保留 GFM 任务列表的受控类', () => {
    const c = html('- [x] 已完成\n- [ ] 待办')
    expect(c.querySelector('li.task-list-item')).not.toBeNull()
  })

  it('保留 figure/figcaption 排版标签', () => {
    const c = html('<figure><figcaption>图注</figcaption></figure>')
    expect(c.querySelector('figure')).not.toBeNull()
    expect(c.querySelector('figcaption')?.textContent).toBe('图注')
  })
})