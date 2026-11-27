import {
  Accessibility,
  Activity,
  Award,
  Bell,
  BookOpen,
  ClipboardCheck,
  Gavel,
  Home,
  Building2,
  Compass,
  Sparkles,
  Kanban,
  MessagesSquare,
  MessageSquareText,
  PenLine,
  ShieldCheck,
  Tags,
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
export const MOBILE_MORE_GROUP_ORDER = ['我的空间', '工作台', '社区', '管理'] as const

// 底部固定 5 Tab：首页 / 主题论坛 / 写 / 内容库 / 我的。
// “写”是一级动作；合集与指南不再占底部席位，收进右上角“更多”，避免入口比动作还多。
export const MOBILE_TABS: MobileTab[] = [
  { to: '/', label: '首页', icon: Home },
  { to: '/forum', label: '主题论坛', icon: MessagesSquare },
  { to: '/submissions/new', label: '写', icon: PenLine },
  { to: '/catalog', label: '内容库', icon: BookOpen },
  { to: '/me', label: '我的', icon: User },
]

// 折叠菜单（header 右上角"⋯"弹出）：收进抽屉时代的次级入口，
// 避免删抽屉后指标/卷期/政策/关于/后台等入口失联。
export const MOBILE_MORE: MobileMoreItem[] = [
  {
    to: '/review',
    search: { tab: 'assignments' },
    label: '互评台',
    icon: ClipboardCheck,
    auth: true,
    roles: ['reviewer', 'senior_reviewer', 'editor', 'editor_in_chief'],
    group: '工作台',
  },
  {
    to: '/submissions/pending',
    label: '内容台',
    icon: Kanban,
    auth: true,
    roles: ['editor', 'editor_in_chief'],
    group: '工作台',
  },
  { to: '/submissions', label: '我的作品', icon: FileText, auth: true, group: '我的空间' },
  { to: '/me', search: { notifications: '1' }, label: '通知', icon: Bell, auth: true, group: '我的空间' },
  { to: '/levels', label: '参与记录', icon: Award, group: '我的空间' },
  { to: '/explore', label: '发现', icon: Sparkles, group: '社区' },
  { to: '/issues', label: '卷', icon: Layers3, group: '社区' },
  { to: '/guide', label: '怎么用', icon: Compass, group: '社区' },
  { to: '/about', label: '关于此处', icon: Building2, group: '社区' },
  { to: '/tags', label: '标签与归档', icon: Tags, group: '社区' },
  { to: '/status', label: '站点状态', icon: Activity, group: '社区' },
  { to: '/accessibility', label: '可访问性', icon: Accessibility, group: '社区' },
  { to: '/privacy', label: '隐私政策', icon: ShieldCheck, group: '社区' },
  { to: '/forum', search: { view: 'feedback' }, label: '反馈与建议', icon: MessageSquareText, group: '社区' },
  { to: '/admin', label: '站务管理', icon: Gavel, auth: true, adminOnly: true, group: '管理' },
]
