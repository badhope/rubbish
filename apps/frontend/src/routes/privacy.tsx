import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Cookie, Database, Mail, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { RevealSection } from '@/components/common/reveal-section'

const SECTIONS = [
  {
    icon: Database,
    title: '我们收集什么',
    body: [
      '账号运行所必需的数据：邮箱、用户名、登录时间、发帖与回复、收藏与举报记录。',
      '你主动填写的研究信息、图片和附件；不要求填写真实姓名、单位或身份证件。',
      '基础访问日志：IP、浏览器类型、请求时间，仅用于安全与故障排查。',
    ],
  },
  {
    icon: Cookie,
    title: 'Cookie 与本地存储',
    body: [
      '必要 Cookie 用于保持登录、防跨站伪造和记住外观设置；不使用第三方广告 Cookie。',
      '草稿、阅读进度和引导状态可能保存在浏览器本地；清除站点数据会一并清除。',
      '你可以在浏览器设置中拒绝非必要存储，但登录与发帖功能可能受影响。',
    ],
  },
  {
    icon: ShieldCheck,
    title: '如何使用与共享',
    body: [
      '数据用于提供社区服务、处理举报与申诉、维护安全和改进产品；不出售给第三方。',
      '公开帖子、回复、作者名和头像对所有人可见；请不要在公开内容里放私人信息。',
      '仅在法律要求、司法机关依法调取或保护用户安全时，才可能向必要第三方提供。',
    ],
  },
  {
    icon: Mail,
    title: '存储、保留与你的权利',
    body: [
      '服务器与域名位于香港；跨境访问按实际服务区域处理。',
      '账号数据保留到账号注销；公开内容删除后，搜索引擎缓存由各搜索引擎自行更新。',
      '你可以申请更正、导出或删除个人数据；涉及违法或侵权的内容会先隐藏再核查。',
      '联系邮箱：info@rubbishasci.cn。',
    ],
  },
]

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
})

function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回首页
      </Link>
      <PageHeader
        title="隐私政策"
        description="只收集社区运转需要的数据；公开内容对所有人可见，私人信息请不要放进来。"
      />
      <div className="space-y-6">
        {SECTIONS.map(({ icon: Icon, title, body }) => (
          <RevealSection key={title} className="border-t pt-5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Icon className="h-5 w-5 text-primary" />
              {title}
            </h2>
            <ul className="mt-2.5 space-y-2">
              {body.map((para) => (
                <li key={para} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/50" />
                  {para}
                </li>
              ))}
            </ul>
          </RevealSection>
        ))}
        <p className="border-t pt-5 text-xs leading-relaxed text-muted-foreground">
          本页与社区公约同步更新；重大变更会提前 14 天在站内公告。
        </p>
      </div>
    </div>
  )
}
