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

// 社区不是期刊：不设主编/审稿人/录用，只保留真实存在的社区岗位。
const ROLES = [
  {
    name: '社区版主',
    role: '版块维护',
    duty: '处理举报、合并重复帖、维护版块秩序；不替作者改正文。',
  },
  {
    name: '内容策展',
    role: '精选与专题',
    duty: '挑出值得读的荒诞论文体，做专题、写推荐语；不做“录用”决定。',
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
  ['2026 年 10 月', 'Rubbish 上线，最初以“学术底刊”的形式做长文阅读与讨论。'],
  ['2026 年 11 月', '停止期刊化：不再做卷期、录用、审稿与“发表”，转为荒诞论文体创作社区。'],
  ['现在', '社区保留长文作品库与论坛；不提供 ISSN / CN / DOI，也不承诺任何学术评价。'],
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
        description="Rubbish 是一个荒诞论文体创作社区：用论文格式写荒诞，用社区方式认真讨论。"
      />
      <AboutTabs active="about" />

      <div className="space-y-10">
        <RevealSection className="max-w-3xl">
          <div>
            <p className="font-serif text-lg leading-relaxed">
              「把荒诞写得像真的，把讨论做得像社区。」
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Rubbish 不是期刊，也不做出版。这里没有卷期、没有录用通知、没有审稿人身份，
              也没有 ISSN / CN / DOI。你写的是作品，读者读的是作品，两者之间只隔着一个帖子。
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              我们保留论文体的形式感：标题、摘要、关键词、方法、讨论、参考文献都可以有；
              但它们是写作道具，不是学术承诺。虚构作品会明确标注，真实材料要能核查。
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              不收版面费，不卖版面，不承诺职称认定，也不把站内热度包装成学术指标。
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
            以上是社区岗位，不是编辑部职位；不虚构姓名、头衔或机构。
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
              ['明确标注虚构', '荒诞论文体作品必须标注“虚构创作 / 讽刺文学”，不冒充真实研究。'],
              ['不碰真人真机构', '不点名真实人物、机构、基金号；不伪造 DOI、ISSN、CN 或录用通知。'],
              ['可核查与不侵权', '引用真实材料要能核查；图片、表格与长段引用不得侵犯版权。'],
              ['社区处理', '人身攻击、隐私泄露、违法内容与侵权内容会被移除；作者可申诉。'],
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
              { icon: ScrollText, label: '站点性质', value: '荒诞论文体创作社区 · 非出版机构' },
              { icon: Globe, label: '访问与托管', value: '香港服务器与香港域名；不提供学术出版服务' },
              { icon: Building2, label: '运营', value: 'Rubbish 社区团队' },
              { icon: ShieldCheck, label: '标识', value: '不使用 ISSN / CN / DOI；作品仅有站内编号' },
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
