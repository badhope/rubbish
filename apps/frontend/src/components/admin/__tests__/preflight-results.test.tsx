import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PreflightResults } from '../preflight-results'

const result = {
  status: 'fail' as const,
  summary: '有硬冲突，先修正再保存。',
  items: [
    { key: 'slug', label: '公告标识', status: 'fail' as const, detail: '标识已重复。' },
    { key: 'overlap', label: '同时在线', status: 'warn' as const, detail: '另一条公告也在展示。' },
    { key: 'copy', label: '标题与正文', status: 'ok' as const, detail: '标题 8 字，正文 28 字。' },
  ],
}

describe('PreflightResults', () => {
  it('分别呈现硬冲突、提醒与通过项，并保留摘要', () => {
    render(<PreflightResults result={result} />)
    expect(screen.getByText(result.summary)).toBeInTheDocument()
    expect(screen.getByText('公告标识')).toBeInTheDocument()
    expect(screen.getByText('标识已重复。')).toBeInTheDocument()
    expect(screen.getByText('同时在线')).toBeInTheDocument()
    expect(screen.getByText('标题与正文')).toBeInTheDocument()
  })

  it('没跑过时不占位', () => {
    const { container } = render(<PreflightResults result={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
