import {
  BookOpen,
  Gavel,
  Home,
  Building2,
  Compass,
  MessagesSquare,
  MessageSquareText,
  type LucideIcon,
  User,
} from 'lucide-react'

export interface MobileTab {
  to: string
  label: string
  icon: LucideIcon
}

export interface MobileMoreItem {
  to: string
  search?: Record<string, string>
  label: string
  icon: LucideIcon
  /** 仅登录用户可见 */
  auth?: boolean
  adminOnly?: boolean
  /** 任一角色命中即可见（admin 视为全角色） */
  roles?: string[]
  /** 折叠菜单里的分组标题 */
  group: string
}

// 折叠菜单分组顺序
export const MOBILE_MORE_GROUP_ORDER = ['我的', '管理', '消息', '设置'] as const

// 底部固定 5 Tab：首页 / 论文 / 投稿 / 社区 / 我的。
// 论文入口进入总目录，学术与荒诞在目录页内分区；副刊不再单列一级。
export const MOBILE_TABS: MobileTab[] = [
  { to: '/', label: '首页', icon: Home },
  { to: '/forum', label: '社区', icon: MessagesSquare },
  { to: '/catalog', label: '作品', icon: BookOpen },
  { to: '/guide', label: '指南', icon: Compass },
  { to: '/me', label: '我的', icon: User },
]

// 折叠菜单（header 右上角"⋯"弹出）：收进抽屉时代的次级入口，
// 避免删抽屉后指标/卷期/政策/关于/后台等入口失联。
export const MOBILE_MORE: MobileMoreItem[] = [
  { to: '/about', label: '关于社区', icon: Building2, group: '我的' },
  { to: '/forum', search: { view: 'feedback' }, label: '反馈与建议', icon: MessageSquareText, group: '设置' },
  { to: '/admin', label: '管理后台', icon: Gavel, auth: true, adminOnly: true, group: '管理' },
]
