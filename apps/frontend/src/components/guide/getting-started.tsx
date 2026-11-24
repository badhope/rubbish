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
    body: '不必注册也能读。挑一篇被标出的，或按卷、分区慢慢翻。',
    to: '/catalog',
    label: '去内容库',
  },
  {
    no: '02',
    icon: MessagesSquare,
    title: '说一句',
    body: '读到想接的话，去主题论坛留一句；发问题、找同伴也在那里。',
    to: '/forum',
    label: '去主题论坛',
  },
  {
    no: '03',
    icon: PenLine,
    title: '写一篇',
    body: '长文放进内容库，短话留在主题论坛。登录即可发布，不收费用。',
    to: '/submissions/new',
    label: '开始写',
  },
  {
    no: '04',
    icon: User,
    title: '看自己的进度',
    body: '作品进度、收藏、通知、经验与参与记录，都在「我的」。',
    to: '/me',
    label: '打开我的',
  },
] as const

const MAP = [
  {
    title: '进门先看',
    items: [
      { label: '首页', body: '先知道这里是什么，再决定下一步。', to: '/', icon: Compass },
      { label: '内容库', body: '长文、荒诞写作和自由创作。', to: '/catalog', icon: BookOpen },
      { label: '卷', body: '一卷一条阅读线，卷里再按合集分行。', to: '/issues', icon: Layers3 },
      { label: '主题论坛', body: '短话、提问、复盘、组队和反馈。', to: '/forum', icon: MessagesSquare },
      { label: '关于此处', body: '这里做什么、不做什么，以及怎么联系。', to: '/about', icon: ShieldCheck },
    ],
  },
  {
    title: '登录后，你有一块自己的地方',
    items: [
      { label: '我的', body: '概览、收藏、经验、设置和通知。', to: '/me', icon: User },
      { label: '我的作品', body: '发布进度、修改要求和历史版本。', to: '/submissions', icon: FileText },
      { label: '参与记录', body: '档位与经验来源；不换权限。', to: '/levels', icon: Users },
    ],
  },
  {
    title: '有角色，才会看见',
    items: [
      { label: '互评台', body: '看指派、写互评意见；普通成员不用进。', to: '/review', icon: ClipboardCheck },
      { label: '内容台', body: '处理内容队列、公开安排和推荐。', to: '/submissions/pending', icon: Kanban },
      { label: '站务管理', body: '站点设置、成员、内容治理和审计。', to: '/admin', icon: ShieldCheck },
    ],
  },
] as const

export function GettingStarted() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        headingLevel={2}
        title="三分钟，先走一遍"
        description="先看看这里有什么，再决定从哪走。规则可以晚点读。"
        actions={
          <Button asChild>
            <Link to="/catalog">
              去读一篇
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
          找不到入口，就来这里。阅读、写作、带角色，三层分开写；访客只看见封面和登录入口。
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

      <section className="mt-10 border-t pt-6">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <ShieldCheck className="h-5 w-5 text-primary" />
          先把边界说清楚
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Rubbish 是公开写作与讨论社区，不做学术评价，也不出具职称、学分、学历或公开证明。站内编号只用来定位，
          虚构内容要标注；不碰真人隐私、违法内容和他人版权。
          完整规则见
          <Link to="/guide" search={{ tab: 'policies' }} className="mx-1 text-primary hover:underline">
            边界与处理
          </Link>
          。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="outline">不收费</Badge>
          <Badge variant="outline">开放阅读</Badge>
          <Badge variant="outline">注明出处</Badge>
          <Badge variant="outline">虚构必须标注</Badge>
        </div>
      </section>
    </div>
  )
}
