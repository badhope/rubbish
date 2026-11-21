import { describe, expect, it } from 'vitest'
import { notificationDestination } from '@/lib/notification-link'
import type { NotificationResponse } from '@/lib/types'

function note(overrides: Partial<NotificationResponse>): NotificationResponse {
  return {
    id: 1,
    type: 'system',
    title: '通知',
    body: null,
    related_type: null,
    related_id: null,
    is_read: false,
    created_at: '2026-11-22T10:00:00+08:00',
    ...overrides,
  }
}

describe('notificationDestination', () => {
  it('sends a review invitation to the linked assignment', () => {
    expect(
      notificationDestination(
        note({ type: 'review.invited', related_type: 'review_assignment', related_id: '42' }),
      ),
    ).toMatchObject({
      to: '/review',
      search: { tab: 'assignments', assignment: 42 },
      label: '去互评',
    })
  })

  it('sends an accepted review invitation to the editor\'s submission', () => {
    expect(
      notificationDestination(
        note({ type: 'review.accepted', related_type: 'submission', related_id: '305' }),
      ),
    ).toMatchObject({
      to: '/submissions/pending',
      search: { submission: 305 },
      label: '去处理',
    })
  })

  it('sends a submission result to the author detail', () => {
    expect(
      notificationDestination(
        note({ type: 'submission.decision', related_type: 'submission', related_id: '331' }),
      ),
    ).toMatchObject({
      to: '/submissions',
      search: { submission: 331 },
      label: '看结果',
    })
  })

  it('sends a comment to the public work', () => {
    expect(
      notificationDestination(
        note({ type: 'comment.new', related_type: 'resource', related_id: '306' }),
      ),
    ).toMatchObject({
      to: '/catalog/$resourceId',
      params: { resourceId: '306' },
      label: '读作品',
    })
  })

  it('sends a forum reply to the thread', () => {
    expect(
      notificationDestination(
        note({ type: 'forum.reply', related_type: 'forum_topic', related_id: '18' }),
      ),
    ).toMatchObject({
      to: '/forum/$topicId',
      params: { topicId: '18' },
      label: '看回复',
    })
  })

  it('sends site feedback to the feedback wall item', () => {
    expect(
      notificationDestination(
        note({ type: 'site.feedback', related_type: 'feedback', related_id: '91' }),
      ),
    ).toMatchObject({
      to: '/forum',
      search: { view: 'feedback', feedback: 91 },
      label: '去反馈墙',
    })
  })

  it('sends a claim to the specific card in the claim queue', () => {
    expect(
      notificationDestination(
        note({ type: 'claim.created', related_type: 'author_claim', related_id: '77' }),
      ),
    ).toMatchObject({
      to: '/admin/people',
      search: { section: 'claims', claim: 77 },
      label: '去审批',
    })
  })

  it('does not guess a destination for an unknown opaque reference', () => {
    expect(
      notificationDestination(note({ type: 'system', related_type: 'unknown_thing', related_id: '9' })),
    ).toBeNull()
  })
})
