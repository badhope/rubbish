import {
  BookOpen,
  ClipboardCheck,
  Gavel,
  Home,
  Building2,
  Compass,
  Kanban,
  MessagesSquare,
  MessageSquareText,
  PenLine,
  type LucideIcon,
  User,
  FileText,
  Layers3,
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
export const MOBILE_MORE_GROUP_ORDER = ['工作台', '我的', '管理', '消息', '设置'] as const

// 底部固定 5 Tab：首页 / 社区 / 写 / 文章 / 我的。
// “写”是一级动作；指南不再占底部席位，收进右上角“更多”，避免入口比动作还多。
export const MOBILE_TABS: MobileTab[] = [
  { to: '/', label: '首页', icon: Home },
  { to: '/forum', label: '社区', icon: MessagesSquare },
  { to: '/submissions/new', label: '写', icon: PenLine },
  { to: '/catalog', label: '文章', icon: BookOpen },
  { to: '/me', label: '我的', icon: User },
]

// 折叠菜单（header 右上角"⋯"弹出）：收进抽屉时代的次级入口，
// 避免删抽屉后指标/卷期/政策/关于/后台等入口失联。
export const MOBILE_MORE: MobileMoreItem[] = [
  {
    to: '/review',
    search: { tab: 'assignments' },
    label: '审稿工作台',
    icon: ClipboardCheck,
    auth: true,
    roles: ['reviewer', 'senior_reviewer', 'editor', 'editor_in_chief'],
    group: '工作台',
  },
  {
    to: '/submissions/pending',
    label: '编辑工作台',
    icon: Kanban,
    auth: true,
    roles: ['editor', 'editor_in_chief'],
    group: '工作台',
  },
  { to: '/submissions', label: '我的投稿', icon: FileText, auth: true, group: '我的' },
  { to: '/levels', label: '等级', icon: Layers3, group: '我的' },
  { to: '/guide', label: '指南与规则', icon: Compass, group: '我的' },
  { to: '/about', label: '关于社区', icon: Building2, group: '我的' },
  { to: '/forum', search: { view: 'feedback' }, label: '反馈与建议', icon: MessageSquareText, group: '设置' },
  { to: '/admin', label: '管理后台', icon: Gavel, auth: true, adminOnly: true, group: '管理' },
]
