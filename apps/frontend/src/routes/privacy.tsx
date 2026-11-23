import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Cookie, Database, Mail, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { RevealSection } from '@/components/common/reveal-section'

const SECTIONS = [
  {
    icon: Database,
    title: '我们收下什么',
    body: [
      '账号运转所必需的数据：邮箱、用户名、登录时间，以及说话、回复、收藏与举报记录。',
      '你主动填写的文字、图片与附件。真实姓名、单位或身份证件，都不是必填。',
      '基础访问日志：IP、浏览器类型与请求时间，只用于安全与故障排查。',
    ],
  },
  {
    icon: Cookie,
    title: 'Cookie 与本地留存',
    body: [
      '必要 Cookie 用于保持登录、防止跨站伪造，并记住外观设置；本站不使用第三方广告 Cookie。',
      '草稿与引导状态留在浏览器本地；阅读进度留在账号内，可在「我的收藏 → 最近阅读」逐条移除。',
      '你可以在浏览器设置中拒绝非必要存储；登录与说话功能可能因此受影响。',
    ],
  },
  {
    icon: ShieldCheck,
    title: '如何保管与共享',
    body: [
      '数据用于提供社区服务、处理举报与申诉、维护安全、改进产品；不出售给第三方。',
      '公开的说话、回复、作者名与头像，对所有人可见。私人的事，请不要放进公开文字里。',
      '只有在法律要求、司法机关依法调取，或为保护用户安全时，才可能向必要第三方提供。',
    ],
  },
  {
    icon: Mail,
    title: '留存、删除与你的权利',
    body: [
      '服务器与域名位于香港；跨境访问按实际服务区域处理。',
      '账号数据保留至账号注销。公开内容删除后，搜索引擎缓存由各搜索引擎自行更新。',
      '你可以申请更正、导出或删除个人数据。涉及违法或侵权的内容，会先隐藏，再核查。',
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
        description="只取社区运转所需之物；公开的文字会被所有人看见，私人的事请留在门外。"
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
          本页与《边界与处理》同步更新；重大变更会提前 14 天在站内公告。
        </p>
      </div>
    </div>
  )
}
