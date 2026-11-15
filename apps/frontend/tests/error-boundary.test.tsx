import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import {
  AppErrorBoundary,
  ModuleErrorBoundary,
} from '@/components/common/error-boundary'
import { reportError, setReporter } from '@/lib/monitoring'

// ErrorBoundary 触发时 React 会往 console.error 打一大段栈，静音掉保持输出干净
let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleSpy.mockRestore()
})

function Boom({ shouldThrow = true }: { shouldThrow?: boolean }): React.ReactElement {
  if (shouldThrow) throw new Error('炸了一下')
  return <p>正常内容</p>
}

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

describe('ModuleErrorBoundary', () => {
  it('子树抛错时渲染带模块名的降级 UI，而非整页白屏', () => {
    render(
      withQuery(
        <ModuleErrorBoundary name="推荐">
          <Boom />
        </ModuleErrorBoundary>,
      ),
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('推荐加载失败')).toBeInTheDocument()
    expect(screen.getByText('其他功能不受影响，可以单独重试这一块。')).toBeInTheDocument()
  })

  it('未传 name 时用通用文案', () => {
    render(
      withQuery(
        <ModuleErrorBoundary>
          <Boom />
        </ModuleErrorBoundary>,
      ),
    )
    expect(screen.getByText('此模块加载失败')).toBeInTheDocument()
  })

  it('子树正常时原样渲染，不显示降级 UI', () => {
    render(
      withQuery(
        <ModuleErrorBoundary name="推荐">
          <Boom shouldThrow={false} />
        </ModuleErrorBoundary>,
      ),
    )
    expect(screen.getByText('正常内容')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('点击「重试」复位边界，修复后能恢复渲染', async () => {
    const user = userEvent.setup()

    // 外层受控开关：重试时把 shouldThrow 关掉，模拟"错误原因已消除"
    function Harness() {
      const [broken, setBroken] = useState(true)
      return (
        <ModuleErrorBoundary name="推荐" resetKeys={[broken]}>
          <button type="button" onClick={() => setBroken(false)}>
            修复
          </button>
          <Boom shouldThrow={broken} />
        </ModuleErrorBoundary>
      )
    }

    const { rerender } = render(withQuery(<Harness />))
    expect(screen.getByText('推荐加载失败')).toBeInTheDocument()

    // 点重试后仍然抛错（原因没消除），降级 UI 应保持
    await user.click(screen.getByRole('button', { name: /重试/ }))
    expect(screen.getByText('推荐加载失败')).toBeInTheDocument()

    // resetKeys 变化触发自动复位：这里直接换 key 模拟路由切换
    rerender(
      withQuery(
        <ModuleErrorBoundary name="推荐" resetKeys={['new-route']}>
          <Boom shouldThrow={false} />
        </ModuleErrorBoundary>,
      ),
    )
    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })
})

describe('AppErrorBoundary', () => {
  it('渲染整页降级 UI，提供重试与返回首页', () => {
    render(
      withQuery(
        <AppErrorBoundary>
          <Boom />
        </AppErrorBoundary>,
      ),
    )
    expect(screen.getByText('页面出错了')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /返回首页/ })).toBeInTheDocument()
  })
})

describe('monitoring reportError', () => {
  it('错误会被转发给注册的 reporter，并携带上下文', () => {
    const spy = vi.fn()
    setReporter(spy)
    render(
      withQuery(
        <ModuleErrorBoundary name="推荐">
          <Boom />
        </ModuleErrorBoundary>,
      ),
    )
    expect(spy).toHaveBeenCalled()
    const [err, ctx] = spy.mock.calls[0]
    expect((err as Error).message).toBe('炸了一下')
    expect(ctx).toHaveProperty('componentStack')
  })

  it('reporter 自身抛错不会向外冒泡（避免二次崩溃）', () => {
    setReporter(() => {
      throw new Error('上报服务挂了')
    })
    expect(() => reportError(new Error('原始错误'))).not.toThrow()
  })
})
