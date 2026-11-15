import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetaItem } from '@/components/common/meta-item'
import { formatDateTime } from '@/lib/utils'

/**
 * 这一组是「详情页卡片被超长值撑破」修复的回归测试。
 * jsdom 没有布局引擎，断言不了真实像素，所以锁的是决定布局的 class 契约：
 * 少了 min-w-0，truncate 在 flex 子项上完全不生效（子项默认 min-width:auto）。
 */
describe('MetaItem', () => {
  it('渲染 label 与 value', () => {
    render(<MetaItem label="DOI" value="10.1000/xyz123" />)

    expect(screen.getByText('DOI')).toBeInTheDocument()
    expect(screen.getByText('10.1000/xyz123')).toBeInTheDocument()
  })

  it('value 为空 / 空串时不渲染整行', () => {
    const { container } = render(
      <>
        <MetaItem label="ISSN" value={undefined} />
        <MetaItem label="ISBN" value="" />
      </>,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('ISSN')).toBeNull()
  })

  it('value 带 truncate + min-w-0，label 不被压缩', () => {
    render(<MetaItem label="出版物" value="一个非常非常长的出版物名称" />)

    const label = screen.getByText('出版物')
    const value = screen.getByText('一个非常非常长的出版物名称')

    expect(label.className).toContain('shrink-0')
    expect(value.className).toContain('truncate')
    expect(value.className).toContain('min-w-0')
  })

  it('value 支持 ReactNode（如格式化后的时间戳）', () => {
    render(<MetaItem label="最近阅读" value={<span>{formatDateTime('2026-09-14T14:21:51.181237Z')}</span>} />)

    expect(screen.getByText('最近阅读')).toBeInTheDocument()
    // 裸 ISO 时间戳不该出现在界面上
    expect(screen.queryByText(/2026-09-14T14:21:51/)).toBeNull()
  })
})

describe('formatDateTime', () => {
  it('把后端 ISO 时间戳格式化为本地时间', () => {
    const out = formatDateTime('2026-09-14T14:21:51.181237Z')

    expect(out).not.toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(out).toBe(new Date('2026-09-14T14:21:51.181237Z').toLocaleString())
  })

  it('空值回退为占位符', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('')).toBe('—')
  })

  it('非法日期回退为占位符，不显示 Invalid Date', () => {
    expect(formatDateTime('not-a-date')).toBe('—')
  })

  it('支持自定义 fallback', () => {
    expect(formatDateTime(null, '暂无')).toBe('暂无')
  })
})
