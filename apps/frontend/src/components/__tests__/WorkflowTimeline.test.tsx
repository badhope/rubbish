import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pagination } from '@/components/common/pagination'

describe('Pagination', () => {
  it('总页数 <= 1 时不渲染任何内容', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} onPageChange={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('渲染当前页码与总页数', () => {
    render(<Pagination page={3} totalPages={10} onPageChange={vi.fn()} />)
    expect(screen.getByText('3 / 10')).toBeInTheDocument()
  })

  it('在第一页时「上一页」按钮禁用', () => {
    render(<Pagination page={1} totalPages={5} onPageChange={vi.fn()} />)
    const prev = screen.getByRole('button', { name: /上一页/ })
    expect(prev).toBeDisabled()
  })

  it('在最后一页时「下一页」按钮禁用', () => {
    render(<Pagination page={5} totalPages={5} onPageChange={vi.fn()} />)
    const next = screen.getByRole('button', { name: /下一页/ })
    expect(next).toBeDisabled()
  })

  it('在中间页时两按钮都可点击', () => {
    render(<Pagination page={3} totalPages={5} onPageChange={vi.fn()} />)
    const prev = screen.getByRole('button', { name: /上一页/ })
    const next = screen.getByRole('button', { name: /下一页/ })
    expect(prev).not.toBeDisabled()
    expect(next).not.toBeDisabled()
  })

  it('点击「上一页」触发 onPageChange(page - 1)', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<Pagination page={3} totalPages={5} onPageChange={spy} />)
    await user.click(screen.getByRole('button', { name: /上一页/ }))
    expect(spy).toHaveBeenCalledWith(2)
  })

  it('点击「下一页」触发 onPageChange(page + 1)', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<Pagination page={3} totalPages={5} onPageChange={spy} />)
    await user.click(screen.getByRole('button', { name: /下一页/ }))
    expect(spy).toHaveBeenCalledWith(4)
  })

  it('totalPages 为 0 时不渲染', () => {
    const { container } = render(
      <Pagination page={1} totalPages={0} onPageChange={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })
})
