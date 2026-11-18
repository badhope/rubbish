import {
  BookOpen,
  ClipboardCheck,
  FileSignature,
  Gavel,
  Home,
  Eye,
  Layers,
  Building2,
  PenLine,
  Rocket,
  Activity,
  Flag,
  ShieldCheck,
  Users,
  CalendarDays,
  Megaphone,
  MessagesSquare,
  MessageSquareText,
  MessageSquare,
  Wallet,
  Mail,
  Wrench,
  type LucideIcon,
  User,
  ShoppingBag,
  Settings,
} from 'lucide-react'

export interface MobileTab {
  to: string
  label: string
  icon: LucideIcon
}

export interface MobileMoreItem {
  to: string
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
export const MOBILE_MORE_GROUP_ORDER = ['我的', '工作台', '期刊', '消息', '内容与社区', '用户与权限', '期刊与发布', '系统与安全', '设置'] as const

// 底部固定 5 Tab：首页 / 论文 / 投稿 / 社区 / 我的。
// 论文入口进入总目录，学术与荒诞在目录页内分区；副刊不再单列一级。
export const MOBILE_TABS: MobileTab[] = [
  { to: '/', label: '首页', icon: Home },
  { to: '/catalog', label: '论文', icon: BookOpen },
  { to: '/submissions', label: '投稿', icon: PenLine },
  { to: '/forum', label: '社区', icon: MessagesSquare },
  { to: '/me', label: '我的', icon: User },
]

// 折叠菜单（header 右上角"⋯"弹出）：收进抽屉时代的次级入口，
// 避免删抽屉后指标/卷期/政策/关于/后台等入口失联。
export const MOBILE_MORE: MobileMoreItem[] = [
  { to: '/review/assignments', label: '审稿工作台', icon: ClipboardCheck, auth: true, roles: ['reviewer', 'senior_reviewer', 'editor_in_chief'], group: '工作台' },
  {
    to: '/editor/workbench',
    label: '主编工作台',
    icon: Gavel,
    auth: true,
    roles: ['editor', 'section_editor', 'board_editor', 'deputy_editor', 'chief_editor', 'editor_in_chief'],
    group: '工作台',
  },
  { to: '/sections', label: '栏目', icon: Layers, group: '期刊' },
  { to: '/review/board', label: '审稿广场', icon: Eye, group: '期刊' },
  { to: '/archive', label: '卷期归档', icon: CalendarDays, group: '期刊' },
  { to: '/about', label: '关于与指标', icon: Building2, group: '期刊' },
  { to: '/guide', label: '投稿与操作指南', icon: PenLine, group: '期刊' },
  { to: '/tools', label: '写作工具', icon: Wrench, group: '期刊' },
  { to: '/feedback', label: '反馈与建议', icon: MessageSquareText, group: '设置' },
  { to: '/admin', label: '站点总览', icon: Gavel, auth: true, adminOnly: true, group: '用户与权限' },
  { to: '/admin/users', label: '用户管理', icon: Users, auth: true, adminOnly: true, group: '用户与权限' },
  { to: '/admin/shop', label: 'R 币商城', icon: ShoppingBag, auth: true, roles: ['chief_editor', 'deputy_editor', 'editor_in_chief', 'shop_manager'], group: '内容与社区' },
  { to: '/admin/claims', label: '认领审批', icon: FileSignature, auth: true, adminOnly: true, group: '用户与权限' },
  { to: '/admin/role-applications', label: '角色申请', icon: ClipboardCheck, auth: true, adminOnly: true, group: '用户与权限' },
  { to: '/admin/announcements', label: '公告管理', icon: Megaphone, auth: true, adminOnly: true, group: '内容与社区' },
  { to: '/admin/forum-boards', label: '社区版块', icon: Layers, auth: true, adminOnly: true, group: '内容与社区' },
  { to: '/admin/reports', label: '举报处置', icon: Flag, auth: true, adminOnly: true, group: '内容与社区' },
  { to: '/admin/comments', label: '评论管理', icon: MessageSquare, auth: true, adminOnly: true, group: '内容与社区' },
  { to: '/admin/desk-subscribers', label: '邮件订阅', icon: Mail, auth: true, adminOnly: true, group: '内容与社区' },
  { to: '/admin/finance', label: '财务台账', icon: Wallet, auth: true, adminOnly: true, group: '系统与安全' },
  { to: '/admin/volumes', label: '卷管理', icon: Layers, auth: true, adminOnly: true, group: '期刊与发布' },
  { to: '/admin/issues', label: '期管理', icon: CalendarDays, auth: true, adminOnly: true, group: '期刊与发布' },
  { to: '/admin/journal', label: '期刊信息', icon: Building2, auth: true, adminOnly: true, group: '期刊与发布' },
  { to: '/admin/releases', label: '发布门禁', icon: Rocket, auth: true, adminOnly: true, group: '期刊与发布' },
  { to: '/admin/settings', label: '期刊设置', icon: Settings, auth: true, adminOnly: true, group: '期刊与发布' },
  { to: '/admin/audit-logs', label: '审计日志', icon: ShieldCheck, auth: true, adminOnly: true, group: '系统与安全' },
  { to: '/admin/system-health', label: '系统健康', icon: Activity, auth: true, adminOnly: true, group: '系统与安全' },
]
