import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Building2, Globe, Mail, ScrollText, ShieldCheck, Users } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { RevealSection } from '@/components/common/reveal-section'

export const Route = createFileRoute('/about')({
  component: AboutPage,
})

// 谁在守着这张桌子：管理、策展、技术与治理；不虚构头衔。
const ROLES = [
  {
    name: '社区管理',
    role: '看门与扫尘',
    duty: '处理举报、合并重复话题、把吵起来的人拉开；不替作者改正文。',
  },
  {
    name: '内容策展',
    role: '精选与合集',
    duty: '从公开内容里挑值得停下来的作品，做合集、写几句推荐；只指路，不替读者下结论。',
  },
  {
    name: '技术维护',
    role: '平台与存档',
    duty: '让发布、阅读、搜索和旧链接一直能用；不碰内容判断。',
  },
  {
    name: '社区治理',
    role: '规则与申诉',
    duty: '接侵权、隐私和版权投诉；遇到利益冲突就回避。',
  },
]

const TIMELINE = [
  ['2026 年 10 月', '社区和内容库开门：说话留在主题论坛，长文放进内容库。'],
  ['2026 年 11 月', '指南和规则页补齐；说话不再需要申请资格。'],
  ['现在', '问题、失败、复盘、组队和站务，都还在同一张桌子上。'],
]

function AboutPage() {
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
        title="关于 Rubbish"
        description="一张摊开的桌面：问题可以怪，文字可以未竟，话要说明白。"
      />

      <div className="space-y-10">
        <RevealSection className="max-w-3xl">
          <div>
            <p className="font-serif text-lg leading-relaxed">
              「认真到荒诞，公开到失败。」
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Rubbish 从第一天起就是一张公开的桌面：说话留主题论坛，长文进内容库。你可以只留一个问题，
              也可以把一次写作、一次尝试、一段现场观察，慢慢写完。
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              这里收选题与计划、过程记录、现场观察、失败复盘、组队招募，也收小说和诗。
              荒诞不是偷懒的借口：设定要站得住，材料要能对上。
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              不收费，不卖置顶，也不把热度说成评价。文字好不好，留给读者慢慢讲。
            </p>
          </div>
        </RevealSection>

        <RevealSection>
          <h2 className="flex items-center gap-2 text-xl font-medium">
            <Users className="h-5 w-5 text-primary" />
            谁在守着这张桌子
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
            名字不重要；有事，总能找到人。
          </p>
        </RevealSection>

        <RevealSection>
          <h2 className="text-xl font-medium">这张桌子怎样长成</h2>
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
            文字的边界
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              ['虚构要标出来', '虚构故事、讽刺写作、思想实验，在标题区或正文开头写一句“虚构创作”。'],
              ['真实材料可核查', '引用别人的文字、数据、图片，把出处写清；自己编的出处，标一句“虚构出处”。'],
              ['尊重真人隐私', '不点名真实的人、单位、病历和聊天记录。讽刺可以尖，但别让人对号入座。'],
              ['版权与处理', '盗图、洗稿、未经授权的搬运会下架；人身攻击、隐私泄露和违法内容会移除，作者可以申诉。'],
            ].map(([title, body]) => (
              <div key={title} className="border-t pt-3">
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </RevealSection>

        <RevealSection>
          <h2 className="text-xl font-medium">关于此处</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              { icon: ScrollText, label: '站点性质', value: '公开写作与讨论社区' },
              { icon: Globe, label: '访问与托管', value: '香港服务器与香港域名' },
              { icon: Building2, label: '运营', value: 'Rubbish 团队' },
              { icon: ShieldCheck, label: '标识', value: '站内编号只用来定位' },
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
            <ShieldCheck className="h-5 w-5 text-primary" />
            这里不做什么
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            这里只是一张公开的桌面：可读，可写，可聊。站内编号只用于定位；精选、热度与档位都不是学术评价。若你需要正式发表材料，请另寻出版渠道，不要让这里的记录代替。
          </p>
        </RevealSection>

        <RevealSection className="border-t pt-6">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <Mail className="h-5 w-5 text-primary" />
            写信给我们
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            版权、隐私、举报与申诉请发邮件到{' '}
            <a href="mailto:info@rubbishasci.cn" className="text-primary hover:underline">
              info@rubbishasci.cn
            </a>
            。社区规则见{' '}
            <Link to="/guide" search={{ tab: 'policies' }} className="text-primary hover:underline">
              边界与处理
            </Link>。
          </p>
        </RevealSection>
      </div>
    </div>
  )
}
