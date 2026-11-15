import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Loading, ErrorState, EmptyState } from '@/components/common/state'

describe('Loading', () => {
  it('渲染加载中文本和旋转图标', () => {
    render(<Loading />)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('支持自定义 className', () => {
    const { container } = render(<Loading className="my-custom" />)
    expect(container.firstChild).toHaveClass('my-custom')
  })
})

describe('ErrorState', () => {
  it('渲染默认错误消息', () => {
    render(<ErrorState />)
    expect(screen.getByText('加载失败')).toBeInTheDocument()
  })

  it('渲染自定义错误消息', () => {
    render(<ErrorState message="网络连接失败" />)
    expect(screen.getByText('网络连接失败')).toBeInTheDocument()
  })

  it('传入 onRetry 时渲染重试按钮', () => {
    render(<ErrorState message="出错了" onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('不传 onRetry 时不渲染重试按钮', () => {
    render(<ErrorState message="出错了" />)
    expect(screen.queryByRole('button', { name: /重试/ })).not.toBeInTheDocument()
  })

  it('点击重试按钮触发 onRetry', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    render(<ErrorState message="出错了" onRetry={spy} />)
    await user.click(screen.getByRole('button', { name: /重试/ }))
    expect(spy).toHaveBeenCalledOnce()
  })
})

describe('EmptyState', () => {
  it('渲染默认标题', () => {
    render(<EmptyState />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })

  it('渲染自定义标题', () => {
    render(<EmptyState title="没有搜索结果" />)
    expect(screen.getByText('没有搜索结果')).toBeInTheDocument()
  })

  it('渲染自定义描述', () => {
    render(
      <EmptyState
        title="暂无数据"
        description="还没有任何资源，点击上方按钮添加"
      />,
    )
    expect(
      screen.getByText('还没有任何资源，点击上方按钮添加'),
    ).toBeInTheDocument()
  })

  it('不传 description 时不渲染描述文本', () => {
    render(<EmptyState title="暂无数据" />)
    // 仅标题和图标区域，没有额外描述
    expect(screen.queryByText(/还没有/)).not.toBeInTheDocument()
  })

  it('传入 action 时渲染自定义操作', () => {
    render(
      <EmptyState
        title="暂无数据"
        action={<button type="button">创建</button>}
      />,
    )
    expect(screen.getByRole('button', { name: '创建' })).toBeInTheDocument()
  })

  it('不传 action 时无额外按钮', () => {
    render(<EmptyState title="暂无数据" />)
    const buttons = screen.queryAllByRole('button')
    expect(buttons).toHaveLength(0)
  })
})
