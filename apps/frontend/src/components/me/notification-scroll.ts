/**
 * 通知列表滚动容器的纯逻辑：类名约束与键盘动作映射。
 *
 * 抽成纯函数是为了在不渲染 Radix Dialog / react-query 的前提下，
 * 用单测锁定「容器必须具备高度约束 + 纵向滚动 + 滚动链隔离」这组属性，
 * 以及上下键 / PageUp / PageDown / Home / End 的滚动映射。
 */

/** 单行（方向键）滚动的像素量，与常见滚轮一格的体感对齐。 */
export const NOTIFICATION_LINE_SCROLL_PX = 40

/**
 * 通知列表滚动区必须带的样式约束：
 * - `min-h-0 flex-1`：在 flex 列布局里把高度约束在剩余空间内，而不是被内容撑高；
 * - `overflow-y-auto`：内容超出时才出现纵向滚动；
 * - `overscroll-contain`：滚动到边界后不把手势链到背景页；
 * - `px-5`：左右内边距（与原布局一致）。
 */
export const NOTIFICATION_LIST_CLASS =
  'min-h-0 flex-1 overflow-y-auto overscroll-contain px-5'

export type NotificationScrollAction =
  | { mode: 'line'; direction: 1 | -1 }
  | { mode: 'page'; direction: 1 | -1 }
  | { mode: 'top' }
  | { mode: 'bottom' }

const KEY_ACTIONS: Record<string, NotificationScrollAction> = {
  ArrowDown: { mode: 'line', direction: 1 },
  ArrowUp: { mode: 'line', direction: -1 },
  PageDown: { mode: 'page', direction: 1 },
  PageUp: { mode: 'page', direction: -1 },
  Home: { mode: 'top' },
  End: { mode: 'bottom' },
}

/**
 * 把键盘按键映射成列表滚动动作；不支持的按键返回 null，交给默认行为。
 */
export function notificationListScrollAction(
  key: string,
): NotificationScrollAction | null {
  return KEY_ACTIONS[key] ?? null
}
