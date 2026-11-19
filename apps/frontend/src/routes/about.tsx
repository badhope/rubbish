import { createFileRoute, Link, useSearch } from '@tanstack/react-router'
import { ArrowLeft, Building2, Globe, Mail, Newspaper, ScrollText } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { CoverArt } from '@/components/common/cover-art'
import { RevealSection } from '@/components/common/reveal-section'
import { JournalMetricsPage } from '@/components/about/journal-metrics'
import { DeskPage } from '@/components/about/desk-page'
import { SupportPage } from '@/components/about/support-page'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/about')({
  validateSearch: (search: Record<string, unknown>) => ({
    tab:
      search.tab === 'metrics'
        ? 'metrics'
        : search.tab === 'desk'
          ? 'desk'
          : search.tab === 'support'
            ? 'support'
            : 'about',
  }),
  component: AboutPage,
})

function AboutTabs({ active }: { active: 'about' | 'metrics' | 'desk' | 'support' }) {
  return (
    <div className="mb-6 flex border-b">
      {[
        { value: 'about', label: '关于本刊' },
        { value: 'desk', label: '主编桌' },
        { value: 'support', label: '成本公开' },
        { value: 'metrics', label: '本刊数据' },
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

// 关于本刊：定位、岗位职责、刊史与联系方式。
// 本站是小型独立出版项目，不虚构编委姓名、头衔或机构。对外展示的是
// 真实存在的岗位与职责边界，而不是一套看起来像大刊的假阵容。

const BOARD = [
  {
    name: '主编岗',
    role: '终审',
    affiliation: '录用 · 修回 · 拒稿',
    note: '对每篇稿件的最终去留有决定权，并对评审口径的一致性负责。',
  },
  {
    name: '学术编辑岗',
    role: '学术质量',
    affiliation: '初筛 · 送审 · 复审',
    note: '判断选题是否成立、方法是否可复现、证据是否支撑结论；不替作者补实验。',
  },
  {
    name: '副刊编辑岗',
    role: '荒诞与文体',
    affiliation: '设定 · 结构 · 文风',
    note: '荒诞赛道按“设定是否新、内部是否自洽、执行是否完整”审，不套学术论文的样本量尺子。',
  },
  {
    name: '出版伦理岗',
    role: '诚信与更正',
    affiliation: '引用 · 数据 · 撤稿',
    note: '核查引用、数据与 AI 使用声明；受理更正、申诉与撤稿，利益冲突时回避。',
  },
  {
    name: '技术出版岗',
    role: '平台与存档',
    affiliation: '投稿 · 评审 · 阅读',
    note: '维护投稿、匿名评审、PDF/Word 导出与长期可读性；不介入学术判断。',
  },
  {
    name: '审稿人池',
    role: '评审',
    affiliation: '匿名 · 逐维证据',
    note: '按赛道维度逐项给分；理由与正文证据选填，审稿人身份不公开。',
  },
]

const TIMELINE = [
  ['2026 年 10 月', '创刊。首卷上线，投稿、匿名评审与在线阅读全流程开放。'],
  ['2026 年 11 月', '五入口与社区版块上线；学术轨与荒诞轨分轨评审，不再共用一把尺子。'],
  ['2026 年 11 月', 'RQS v5.1 收口：学术五维 / 荒诞六维、逐维证据选填、分区硬门槛；90 分只留给满分档完成度。'],
  ['现在', '底刊编号由本站自建；DOI/ISSN 由作者按需选择，不伪造、不强制。'],
]

function AboutPage() {
  const { tab } = useSearch({ from: '/about' })
  if (tab === 'metrics') {
    return (
      <div className="about-page mx-auto w-full max-w-[1100px]">
        <AboutTabs active="metrics" />
        <JournalMetricsPage embedded />
      </div>
    )
  }
  if (tab === 'desk') {
    return (
      <div className="about-page mx-auto w-full max-w-[1100px]">
        <AboutTabs active="desk" />
        <DeskPage />
      </div>
    )
  }
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
        title="关于本刊"
        description="Rubbish 是一份学术底刊：格式从严，题材放宽，认真写下的东西都有一席之地。"
      />
      <AboutTabs active="about" />

      <div className="space-y-10">
        <RevealSection className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
          <CoverArt seed="about" title="Rubbish" subtitle="Vol. 1 · 2026" className="w-full max-w-52" />
          <div>
            <p className="font-serif text-lg leading-relaxed">
              「学问的尊严在于格式，不在题材。」
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Rubbish 创刊于 2026 年，免费投稿、免费阅读、免费评审。我们收标准学术研究，
              也收传统刊物不愿碰的脑洞选题；前提是论证自洽、格式规范。玩梗也可以认真。
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              我们把「底刊」当作一种取舍：不参加顶刊竞赛，不拿影响因子当门槛，也不把评审当装饰。
              每篇稿件有编辑处置记录、站内编号和可引用版本；DOI 与 ISSN 由作者和编辑部按需选择。
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              不收版面费，不设学历门槛，不问出处。
            </p>
          </div>
        </RevealSection>

        <RevealSection>
          <h2 className="text-xl font-medium">编辑部岗位与职责</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {BOARD.map((m) => (
              <div key={m.name} className="border-t pt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{m.name}</p>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                    {m.role}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{m.affiliation}</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{m.note}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            本站是小型独立出版项目。上表只列真实岗位与职责，不虚构姓名、头衔或机构；
            审稿人身份仅编辑部掌握。
          </p>
        </RevealSection>

        <RevealSection>
          <h2 className="text-xl font-medium">刊史</h2>
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
          <h2 className="text-xl font-medium">出版信息</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              { icon: Newspaper, label: '刊名', value: 'Rubbish（学术底刊 · Academic Bottom Journal）' },
              { icon: ScrollText, label: '编号', value: '每篇自动分配底刊编号；DOI 选填；ISSN 不强制' },
              { icon: Globe, label: '出版形式', value: '纯数字出版 · 滚动刊出 + 不定期合卷' },
              { icon: ScrollText, label: '收录范围', value: '严肃格式与自由主题统一评审 · 学术/副刊/吐槽分类呈现' },
              { icon: Building2, label: '出版方', value: 'Rubbish 编辑部' },
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
            联系编辑部
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            投稿事宜请先读
            <Link to="/guide" search={{ tab: 'authors' }} className="mx-1 text-primary hover:underline">
              作者指南
            </Link>
            ；投诉与举报请在邮件主题注明「伦理」。一般咨询在 5 个工作日内回复。
          </p>
          <p className="mt-3 text-sm">
            编辑部邮箱：<a href="mailto:info@rubbishasci.cn" className="font-medium text-primary hover:underline">info@rubbishasci.cn</a>
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            本刊无广告、无付费墙，服务器与域名成本公开在这里：
            <Link to="/about" search={{ tab: 'support' }} className="ml-1 text-primary hover:underline">
              成本账本
            </Link>
          </p>
        </RevealSection>
      </div>
    </div>
  )
}
