import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  Compass,
  FileText,
  FolderOpen,
  Kanban,
  Layers3,
  MessagesSquare,
  PenLine,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const QUICK_START = [
  {
    no: '01',
    icon: BookOpen,
    title: '先读一篇',
    body: '不用注册。挑一篇精选，或者按合集、研究方向翻。',
    to: '/catalog',
    label: '去内容库',
  },
  {
    no: '02',
    icon: MessagesSquare,
    title: '说一句',
    body: '读到想接的话，去讨论区回一句；发问题、找同伴也在那里。',
    to: '/forum',
    label: '去讨论区',
  },
  {
    no: '03',
    icon: PenLine,
    title: '发一篇',
    body: '长文进内容库，短帖进讨论区。注册后直接发，不收费。',
    to: '/submissions/new',
    label: '开始写',
  },
  {
    no: '04',
    icon: User,
    title: '看自己的进度',
    body: '作品进度、收藏、通知、积分和参与记录，都在“我的”。',
    to: '/me',
    label: '打开我的',
  },
] as const

const MAP = [
  {
    title: '公开区：不用登录',
    items: [
      { label: '首页', body: '看懂这里是什么，直接选下一步。', to: '/', icon: Compass },
      { label: '内容库', body: '读研究长文、荒诞研究与自由创作。', to: '/catalog', icon: BookOpen },
      { label: '合集', body: '按一组一组的内容顺序读，不按刊期。', to: '/issues', icon: Layers3 },
      { label: '讨论区', body: '短帖、提问、复盘、组队和反馈。', to: '/forum', icon: MessagesSquare },
      { label: '关于站点', body: '站点性质、边界和联系方式。', to: '/about', icon: ShieldCheck },
    ],
  },
  {
    title: '登录后：你自己的空间',
    items: [
      { label: '我的', body: '概览、收藏、积分、设置和通知。', to: '/me', icon: User },
      { label: '我的作品', body: '看发布进度、修改要求和历史版本。', to: '/submissions', icon: FileText },
      { label: '参与记录', body: '看活跃等级和积分来源，不影响权限。', to: '/levels', icon: Users },
    ],
  },
  {
    title: '有角色才出现',
    items: [
      { label: '互评台', body: '评议成员看指派、写反馈；普通成员不需要进。', to: '/review', icon: ClipboardCheck },
      { label: '内容台', body: '整理成员处理队列、初审和公开安排。', to: '/submissions/pending', icon: Kanban },
      { label: '站务管理', body: '站点配置、用户、内容治理与审计。', to: '/admin', icon: ShieldCheck },
    ],
  },
] as const

const GLOSSARY = [
  ['投稿 / 审稿 / 录用', '发布作品 / 互评 / 通过'],
  ['卷 / 期', '合集（只表示一组内容，不表示刊期）'],
  ['编辑工作台', '内容台'],
  ['审稿工作台', '互评台'],
  ['等级 Level', '参与记录（只记活跃，不给权限）'],
  ['站内编号 R-…', '站内定位号；不是 DOI，不能当正式引用'],
  ['BibTeX / RIS / 引用格式', '已移除；只保留一段“站内标注”文本'],
]

export function GettingStarted() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="3 分钟上手"
        description="先知道这里有什么、从哪进；不用记旧名字，也不用先读一堆规则。"
        actions={
          <Button asChild>
            <Link to="/catalog">
              直接开始读
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2">
        {QUICK_START.map(({ no, icon: Icon, title, body, to, label }) => (
          <Card key={no} className="border-border/80">
            <CardContent className="flex gap-3 p-4">
              <span className="font-mono text-xs text-muted-foreground">{no}</span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4 text-primary" />
                  {title}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
                <Link to={to} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  {label} <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-xl font-medium">
          <FolderOpen className="h-5 w-5 text-primary" />
          全站地图
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          找不到某个功能时，先来这里。入口按“公开 / 登录后 / 有角色”分，不会把后台按钮塞给访客。
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {MAP.map((group) => (
            <div key={group.title} className="border-t pt-4">
              <p className="text-sm font-medium">{group.title}</p>
              <div className="mt-2 space-y-2.5">
                {group.items.map(({ label, body, to, icon: Icon }) => (
                  <Link
                    key={label}
                    to={to}
                    className="group flex items-start gap-2.5 rounded-md p-1.5 transition-colors hover:bg-muted/60"
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-sm font-medium group-hover:text-primary">
                        {label}
                        <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{body}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-medium">名字对照</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          以前看过旧版的人，按这张表认新入口；新用户不用记旧名字。
        </p>
        <div className="mt-4 divide-y border-y">
          {GLOSSARY.map(([oldName, newName]) => (
            <div key={oldName} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4">
              <p className="text-sm text-muted-foreground line-through decoration-muted-foreground/40">{oldName}</p>
              <p className="text-sm font-medium">{newName}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t pt-6">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <ShieldCheck className="h-5 w-5 text-primary" />
          先把边界说清楚
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Rubbish 是公开写作与讨论社区，不是期刊、出版社或学术评价机构。站内编号只用于站内定位，
          不提供 DOI、ISSN、职称认定、学分或学历背书。虚构内容要标注；不碰真人隐私、违法内容和他人版权。
          完整规则见
          <Link to="/guide" search={{ tab: 'policies' }} className="mx-1 text-primary hover:underline">
            规则与边界
          </Link>
          。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline">不收费</Badge>
          <Badge variant="outline">不是期刊</Badge>
          <Badge variant="outline">站内编号不是 DOI</Badge>
          <Badge variant="outline">虚构必须标注</Badge>
        </div>
      </section>
    </div>
  )
}
