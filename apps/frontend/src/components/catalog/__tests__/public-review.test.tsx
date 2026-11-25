import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PublicReviewCard } from '../public-review'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PublicReviewCard resourceId={316} enabled />
    </QueryClientProvider>,
  )
}

describe('PublicReviewCard', () => {
  it('只渲染公开意见、署名状态与作者回复，不泄漏编辑内部意见', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        resource_id: 316,
        reports: [
          {
            id: 1,
            round: 1,
            recommendation: 'accept',
            comments_to_author: '公开意见：建议补充限制条件。',
            reviewer_anonymous: true,
            reviewer_label: '匿名审稿人 1',
            submitted_at: '2026-11-24T11:45:53Z',
          },
          {
            id: 2,
            round: 2,
            recommendation: 'minor_revision',
            comments_to_author: '第二轮：小修后可公开。',
            reviewer_anonymous: false,
            reviewer_label: '署名审稿人',
            submitted_at: '2026-11-24T12:00:00Z',
          },
        ],
        author_response: '作者回复：已补充限制条件。',
        author_response_at: '2026-11-24T12:30:00Z',
      },
    })

    renderCard()
    expect(await screen.findByText('同行评审记录')).toBeInTheDocument()
    expect(screen.getByText('匿名审稿人 1')).toBeInTheDocument()
    expect(screen.getByText('署名审稿人')).toBeInTheDocument()
    expect(screen.getByText('公开意见：建议补充限制条件。')).toBeInTheDocument()
    expect(screen.getByText('作者回复：已补充限制条件。')).toBeInTheDocument()
    expect(screen.queryByText(/编辑机密/)).toBeNull()
  })
})
