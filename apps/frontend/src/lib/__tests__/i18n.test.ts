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

  it('translates the admin domain tabs that used to fall back to Chinese', () => {
    expect(translateText('内容', 'en')).toBe('Content')
    expect(translateText('系统', 'en')).toBe('System')
  })

  it('translates role-application and area labels introduced in 1.20.17', () => {
    expect(translateText('角色申请', 'en')).toBe('Role applications')
    expect(translateText('认领', 'en')).toBe('Claims')
    expect(translateText('科目领域', 'en')).toBe('Subject areas')
    expect(translateText('审稿人领域', 'en')).toBe('Reviewer areas')
    expect(translateText('审稿能力标签', 'en')).toBe('Review skills')
  })

  it('translates area counts without hard-coding the member', () => {
    expect(translateText('科目 2 · 审稿 1', 'en')).toBe('Subjects 2 · Reviews 1')
    expect(translateText('本页 50 人', 'en')).toBe('50 on this page')
  })
})
