import { useSyncExternalStore } from 'react'

/**
 * 通用媒体查询订阅：布局需要“按设备类型重排”而不是 CSS 隐藏时用它，
 * 避免隐藏的组件仍然在后台跑重活（比如 pagedjs 排版）。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (callback: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', callback)
    return () => mql.removeEventListener('change', callback)
  }
  const getSnapshot = () =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(query).matches
      : false
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
