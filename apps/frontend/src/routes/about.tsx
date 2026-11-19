import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Building2, Globe, Mail, ScrollText, ShieldCheck, Users } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { RevealSection } from '@/components/common/reveal-section'
import { SupportPage } from '@/components/about/support-page'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/about')({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search.tab === 'support' ? 'support' : 'about',
  }),
  component: AboutPage,
})

function AboutTabs({ active }: { active: 'about' | 'support' }) {
  return (
    <div className="mb-6 flex border-b">
      {[
        { value: 'about', label: '关于社区' },
        { value: 'support', label: '成本公开' },
      ].map((t) => (
        <Link
          key={t.value}
          to="/about"
          search={{ tab: t.value }}
          className={cn(
            'border-b-2 px-0 py-2.5 pr-8 text-sm font-medium transition-colors',
            active === t.value
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}

// 社区岗位：版主、策展、技术与治理；不虚构头衔。
const ROLES = [
  {
    name: '社区版主',
    role: '版块维护',
    duty: '处理举报、合并重复帖、维护版块秩序；不替作者改正文。',
  },
  {
    name: '内容策展',
    role: '精选与专题',
    duty: '挑出值得读的帖子与长文，做专题、写推荐语；只推荐，不替读者下结论。',
  },
  {
    name: '技术维护',
    role: '平台与存档',
    duty: '维护发布、阅读、搜索、导出与长期可读性；不介入内容判断。',
  },
  {
    name: '社区治理',
    role: '规则与申诉',
    duty: '受理侵权、隐私、人身攻击与版权投诉；利益冲突时回避。',
  },
]

const TIMELINE = [
  ['2026 年 10 月', 'Rubbish 社区与档案上线：短帖做讨论，长记录做档案。'],
  ['2026 年 11 月', '研究板块、社区指南与社区公约开放；发帖不再需要任何资格审核。'],
  ['现在', '提问、记录、失败、复盘、组队和版务都在同一个社区里。'],
]

function AboutPage() {
  const { tab } = useSearch({ from: '/about' })
  if (tab === 'support') {
    return (
      <div className="about-page mx-auto w-full max-w-[1100px]">
        <AboutTabs active="support" />
        <SupportPage />
      </div>
    )
  }
  return (
    <div className="about-page mx-auto w-full max-w-[1100px]">
      <Link
        to="/"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回首页
      </Link>

      <PageHeader
        title="关于社区"
        description="Rubbish 是一个荒诞科研社区：把不正经的问题当正经课题做，把过程、失败和结果拿出来讨论。"
      />
      <AboutTabs active="about" />

      <div className="space-y-10">
        <RevealSection className="max-w-3xl">
          <div>
            <p className="font-serif text-lg leading-relaxed">
              「正经地荒诞，公开地失败。」
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Rubbish 从第一天就是一个社区：帖子是入口，档案是长记录。你可以只发一个问题，
              也可以把一次实验、一次失败、一段田野观察完整写下来。
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              这里欢迎研究计划、实验记录、田野笔记、失败复盘、组队招募和自由创作。
              荒诞不是免掉方法的理由；设定要清楚，材料要能对上。
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              社区不收任何费用，不卖置顶、不加精收费，也不把站内热度包装成正式评价。
            </p>
          </div>
        </RevealSection>

        <RevealSection>
          <h2 className="flex items-center gap-2 text-xl font-medium">
            <Users className="h-5 w-5 text-primary" />
            社区岗位
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {ROLES.map((m) => (
              <div key={m.name} className="border-t pt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{m.name}</p>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                    {m.role}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{m.duty}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            以上是社区岗位；不虚构姓名、头衔或机构，也不给版主安上旧式头衔。
          </p>
        </RevealSection>

        <RevealSection>
          <h2 className="text-xl font-medium">社区简史</h2>
          <ol className="mt-4 space-y-4 border-l border-border pl-5">
            {TIMELINE.map(([when, what]) => (
              <li key={what} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-primary bg-background"
                />
                <p className="text-sm font-medium">{when}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{what}</p>
              </li>
            ))}
          </ol>
        </RevealSection>

        <RevealSection>
          <h2 className="flex items-center gap-2 text-xl font-medium">
            <ShieldCheck className="h-5 w-5 text-primary" />
            内容边界
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              ['虚构要标出来', '荒诞研究、讽刺写作、思想实验，在标题区或正文开头写明“虚构创作”。'],
              ['真实材料可核查', '引用的文献、数据、图片给得出处；自己编的参考文献统一标注“虚构参考文献”。'],
              ['尊重真人隐私', '不点名真实个人、单位、病历与聊天记录；讽刺指向现象，不指向可识别的人。'],
              ['版权与处理', '盗图、洗稿、未经授权的搬运会被下架；人身攻击、隐私泄露与违法内容会被移除，作者可申诉。'],
            ].map(([title, body]) => (
              <div key={title} className="border-t pt-3">
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </RevealSection>

        <RevealSection>
          <h2 className="text-xl font-medium">站点信息</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              { icon: ScrollText, label: '站点性质', value: '荒诞科研社区' },
              { icon: Globe, label: '访问与托管', value: '香港服务器与香港域名' },
              { icon: Building2, label: '运营', value: 'Rubbish 团队' },
              { icon: ShieldCheck, label: '标识', value: '研究记录只有站内编号，不作正式评价' },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-3 border-t pt-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 text-sm">{value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </RevealSection>

        <RevealSection className="border-t pt-6">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <Mail className="h-5 w-5 text-primary" />
            联系社区
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            版权、隐私、举报与申诉请发邮件到
            <a href="mailto:info@rubbishasci.cn" className="mx-1 text-primary hover:underline">
              info@rubbishasci.cn
            </a>
            。社区规则见
            <Link to="/guide" search={{ tab: 'policies' }} className="mx-1 text-primary hover:underline">
              社区公约
            </Link>
            。
          </p>
        </RevealSection>
      </div>
    </div>
  )
}
