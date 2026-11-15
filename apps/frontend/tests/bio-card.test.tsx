import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BioCard } from '@/components/settings/bio-card'

// 只桩掉网络层：组件行为（草稿态、字数、清除语义）仍然真实渲染。
const patch = vi.fn()
vi.mock('@/lib/api', () => ({
  api: {
    patch: (...args: unknown[]) => patch(...args),
    get: vi.fn(),
  },
}))

function renderCard(initialBio: string | null = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BioCard initialBio={initialBio} />
    </QueryClientProvider>,
  )
}

describe('BioCard', () => {
  beforeEach(() => {
    patch.mockReset()
  })

  it('未修改时保存按钮禁用，输入后启用', async () => {
    const user = userEvent.setup()
    renderCard('已有简介')
    const button = screen.getByRole('button', { name: '保存简介' })
    expect(button).toBeDisabled()

    await user.type(screen.getByRole('textbox'), '补充')
    expect(button).toBeEnabled()
  })

  it('保存时提交 trim 后的简介，并回显服务端返回值', async () => {
    const user = userEvent.setup()
    patch.mockResolvedValue({ data: { bio: '荒诞现象业余观测者' } })
    renderCard(null)

    await user.type(screen.getByRole('textbox'), '  荒诞现象业余观测者  ')
    await user.click(screen.getByRole('button', { name: '保存简介' }))

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1))
    expect(patch).toHaveBeenCalledWith('/users/me', { bio: '荒诞现象业余观测者' })
    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveValue('荒诞现象业余观测者'),
    )
  })

  it('清空后提交空串（后端归一为 None = 清除）', async () => {
    const user = userEvent.setup()
    patch.mockResolvedValue({ data: { bio: null } })
    renderCard('旧简介')

    await user.clear(screen.getByRole('textbox'))
    await user.click(screen.getByRole('button', { name: '保存简介' }))

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/users/me', { bio: '' }))
  })

  it('超过 200 字被截断', async () => {
    const user = userEvent.setup()
    renderCard(null)
    await user.click(screen.getByRole('textbox'))
    // paste 比逐字输入快，且走同一条 onChange 截断逻辑
    await user.paste('字'.repeat(260))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value.length).toBe(200)
    expect(screen.getByText('0 字可用')).toBeInTheDocument()
  })
})
