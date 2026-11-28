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

  it('translates the field page and its controlled field names', () => {
    expect(translateText('计算机科学', 'en')).toBe('Computer science')
    expect(translateText('信息科学', 'en')).toBe('Information science')
    expect(translateText('同领域成员', 'en')).toBe('People in this field')
    expect(translateText('订阅这个方向', 'en')).toBe('Subscribe to this field')
    expect(translateText('1 位同领域成员', 'en')).toBe('1 person in this field')
    expect(translateText('12 篇公开作品', 'en')).toBe('12 public works')
    expect(translateText('2 位互评成员覆盖', 'en')).toBe('2 peer reviewers cover this field')
  })

  it('translates search result metadata and the discover page copy', () => {
    expect(translateText('251 篇作品 · 0 关注者', 'en')).toBe('251 works · 0 followers')
    expect(translateText('· 12 阅读', 'en')).toBe('· 12 reads')
    expect(translateText('发现', 'en')).toBe('Discover')
    expect(translateText('13 个受控方向，进去看同方向的人、最近作品和互评覆盖。', 'en')).toBe(
      '13 controlled fields. Open one to see people, recent work and peer-review coverage.',
    )
    expect(translateText('关注作者 2', 'en')).toBe('2 followed authors')
  })

  it('translates the discipline search filter and empty states', () => {
    expect(translateText('正在按领域找人', 'en')).toBe('Finding people by field')
    expect(translateText('清除领域筛选', 'en')).toBe('Clear field filter')
    expect(translateText('「计算机科学」暂时没有公开成员', 'en')).toBe(
      'No public members in “Computer science” yet',
    )
  })
})
