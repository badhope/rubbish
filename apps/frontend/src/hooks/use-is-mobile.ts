import { useSyncExternalStore } from 'react'

// 移动端断点：< 768px 视为移动设备（与 Tailwind 默认 md 断点对齐）。
const MOBILE_QUERY = '(max-width: 767px)'

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return () => {}
  }
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia(MOBILE_QUERY).matches
}

/**
 * 返回当前是否处于移动视口。
 * 用于在 __root 层切换 MobileAppShell / AppShell，以及页面内做移动专属呈现。
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
