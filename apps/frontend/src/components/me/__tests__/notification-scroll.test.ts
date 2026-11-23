import { describe, expect, it } from 'vitest'
import {
  NOTIFICATION_LINE_SCROLL_PX,
  NOTIFICATION_LIST_CLASS,
  notificationListScrollAction,
} from '../notification-scroll'

describe('通知列表滚动容器约束', () => {
  it('容器类名同时带高度约束、纵向滚动与滚动链隔离', () => {
    const tokens = NOTIFICATION_LIST_CLASS.split(' ')
    // 高度约束：flex 列布局里占满剩余空间，且允许收缩到内容以下
    expect(tokens).toContain('flex-1')
    expect(tokens).toContain('min-h-0')
    // 纵向滚动
    expect(tokens).toContain('overflow-y-auto')
    // 滚到边界后不把手势链到背景页
    expect(tokens).toContain('overscroll-contain')
  })

  it('单行滚动量为正数', () => {
    expect(NOTIFICATION_LINE_SCROLL_PX).toBeGreaterThan(0)
  })
})

describe('通知列表键盘滚动映射', () => {
  it('方向键按行滚动', () => {
    expect(notificationListScrollAction('ArrowDown')).toEqual({
      mode: 'line',
      direction: 1,
    })
    expect(notificationListScrollAction('ArrowUp')).toEqual({
      mode: 'line',
      direction: -1,
    })
  })

  it('PageUp / PageDown 按页滚动', () => {
    expect(notificationListScrollAction('PageDown')).toEqual({
      mode: 'page',
      direction: 1,
    })
    expect(notificationListScrollAction('PageUp')).toEqual({
      mode: 'page',
      direction: -1,
    })
  })

  it('Home / End 跳到首尾', () => {
    expect(notificationListScrollAction('Home')).toEqual({ mode: 'top' })
    expect(notificationListScrollAction('End')).toEqual({ mode: 'bottom' })
  })

  it('不支持的按键返回 null，交给默认行为', () => {
    expect(notificationListScrollAction('Enter')).toBeNull()
    expect(notificationListScrollAction('a')).toBeNull()
    expect(notificationListScrollAction('')).toBeNull()
  })
})
