/**
 * 轻量双语壳层：仅覆盖导航、分组、页头与通用操作。
 *
 * 不假装“全站已英文化”——话题、作品与后台表单仍是中文。
 * 这里的目标是让英文用户在首屏能看懂去哪里，不制造 70 个页面的
 * 半翻译状态。语言选择持久化到 localStorage。
 */
import { useEffect, useState } from 'react'

export type Lang = 'zh' | 'en'

const KEY = 'rubbish.lang'
const EVENT = 'rubbish:lang'

/**
 * 全站英文化尚未完成（话题、作品、表单、后台仍是中文）。
 * 在词条齐备前不暴露切换入口：半翻译比不翻译更容易被当成 bug。
 * 保留这里的所有词表，后续按页面补齐后再把开关打开。
 */
export const SHELL_I18N_ENABLED = false

const NAV_EN: Record<string, string> = {
  '/': 'Home',
  '/forum': 'Discussions',
  '/catalog': 'Library',
  '/issues': 'Collections',
  '/guide': 'How to use',
  '/me': 'Me',
  '/about': 'About',
  '/admin': 'Admin overview',
  '/admin/people': 'People',
  '/admin/economy': 'Points & ledger',
  '/admin/content': 'Content',
  '/admin/system': 'System',
}

const GROUP_EN: Record<string, string> = {
  一级入口: 'Primary',
  我的工作: 'Workspace',
  站点管理: 'Site admin',
  总览: 'Overview',
  成员与权限: 'Members & access',
  内容与讨论: 'Content & discussion',
  系统与安全: 'System & security',
}

const TEXT_EN: Record<string, string> = {
  搜索: 'Search',
  登录: 'Sign in',
  注册: 'Join',
  个人中心: 'Profile',
  账号设置: 'Settings',
  互评台: 'Peer feedback desk',
  内容台: 'Content desk',
  退出登录: 'Sign out',
  展开侧边栏: 'Expand sidebar',
  收起侧边栏: 'Collapse sidebar',
  打开菜单: 'Open menu',
  关闭菜单: 'Close menu',
  账号菜单: 'Account menu',
  跳到主要内容: 'Skip to content',
}

export function getLang(): Lang {
  if (typeof window === 'undefined') return 'zh'
  if (!SHELL_I18N_ENABLED) {
    // 清掉旧版本留下的 en，否则升级后导航仍是英文、正文仍是中文。
    window.localStorage.removeItem(KEY)
    return 'zh'
  }
  return window.localStorage.getItem(KEY) === 'en' ? 'en' : 'zh'
}

export function setLang(lang: Lang): void {
  if (!SHELL_I18N_ENABLED) return
  window.localStorage.setItem(KEY, lang)
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  window.dispatchEvent(new CustomEvent(EVENT, { detail: lang }))
}

export function useLang(): Lang {
  const [lang, set] = useState<Lang>(getLang)
  useEffect(() => {
    const onChange = () => set(getLang())
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [])
  return lang
}

export function navLabel(to: string, zh: string, lang: Lang = getLang()): string {
  return lang === 'en' ? (NAV_EN[to] ?? zh) : zh
}

export function groupLabel(zh: string, lang: Lang = getLang()): string {
  return lang === 'en' ? (GROUP_EN[zh] ?? zh) : zh
}

export function text(key: string, lang: Lang = getLang()): string {
  return lang === 'en' ? (TEXT_EN[key] ?? key) : key
}
