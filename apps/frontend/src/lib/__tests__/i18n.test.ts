import { describe, expect, it } from 'vitest'

import { translateText } from '../i18n'

describe('review copy in the English layer', () => {
  it('translates static public-review labels', () => {
    expect(translateText('同行评审记录', 'en')).toBe('Peer review record')
    expect(translateText('作者回复', 'en')).toBe('Author response')
    expect(translateText('该轮未留下公开意见。', 'en')).toBe('No public comments in this round.')
  })

  it('translates round and anonymous-reviewer patterns', () => {
    expect(translateText('第 1 轮', 'en')).toBe('Round 1')
    expect(translateText('匿名审稿人 2', 'en')).toBe('Anonymous reviewer 2')
  })

  it('translates the latest-count sentence without a hard-coded six', () => {
    expect(translateText('最近公开的 4 篇。先读一两篇，再决定往哪走。', 'en')).toBe(
      'The 4 most recently published pieces. Read one or two, then decide where to go.',
    )
  })
})
