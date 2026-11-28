import { describe, expect, it } from 'vitest'

import { orderForumBoards } from '../admin-board-tree'

describe('orderForumBoards', () => {
  it('keeps a parent and all its children together', () => {
    const rows = [
      { id: 1, parent_id: null, sort_order: 0, name: '写作讨论' },
      { id: 2, parent_id: null, sort_order: 0, name: '招生与导师' },
      { id: 3, parent_id: 2, sort_order: 0, name: '导师招生' },
      { id: 4, parent_id: null, sort_order: 1, name: '记录与复盘' },
      { id: 5, parent_id: 2, sort_order: 1, name: '学生找导师' },
    ]

    expect(orderForumBoards(rows).map((row) => `${row.depth}:${row.name}`)).toEqual([
      '0:写作讨论',
      '0:招生与导师',
      '1:导师招生',
      '1:学生找导师',
      '0:记录与复盘',
    ])
  })

  it('does not lose rows with a missing or cyclic parent', () => {
    const rows = [
      { id: 10, parent_id: 99, sort_order: 0 },
      { id: 11, parent_id: 12, sort_order: 0 },
      { id: 12, parent_id: 11, sort_order: 0 },
    ]

    expect(orderForumBoards(rows).map((row) => row.id).sort()).toEqual([10, 11, 12])
  })
})
