import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  MessageSquare,
  PenLine,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { RevealSection } from '@/components/common/reveal-section'
import { Button } from '@/components/ui/button'

const FORMATS = [
  {
    icon: MessageSquare,
    title: '短帖',
    body: '一个观察、一个反问、一段刚想到的论证。标题写清你想讨论什么，正文三五段就够。',
    hint: '适合：日常脑洞、写作求助、站务反馈',
  },
  {
    icon: FileText,
    title: '论文体',
    body: '标题、摘要、关键词、引言、论证、讨论、参考文献。格式可以正经，结论不必正经。',
    hint: '适合：荒诞命题、讽刺研究、思想实验',
  },
  {
    icon: PenLine,
    title: '自由写作',
    body: '小说、随笔、评论、诗歌、指南。不套论文骨架，只看写得好不好、讨论值不值得接。',
    hint: '适合：叙事、评论、系列连载',
  },
]

const CHECKS = [
  ['标题能被检索', '用一句人话说明主题，不用「论」「浅析」开头堆三层。'],
  ['虚构要标出来', '荒诞论文体、讽刺文学、思想实验，在开头或标题区写明「虚构创作」。'],
  ['材料能对上', '引用真实文献就给可核查信息；自己编的参考文献，统一标注「虚构参考文献」。'],
  ['不碰真人隐私', '不点名真实个人、单位、病历、聊天记录；讽刺指向现象，不指向可识别的人。'],
]

export function AuthorsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to="/forum"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回论坛
      </Link>

      <PageHeader
        title="创作指南"
        description="在这里发帖不需要先把自己包装成作者。想清楚要说什么，写下来，发出去。"
        actions={
          <Button asChild>
            <Link to="/forum" search={{ compose: '1' }}>
              去发帖
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <div className="space-y-10">
        <RevealSection>
          <h2 className="flex items-center gap-2 text-xl font-medium">
            <Sparkles className="h-5 w-5 text-primary" />
            先选一个入口
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {FORMATS.map(({ icon: Icon, title, body, hint }) => (
              <div key={title} className="border-t pt-4">
                <Icon className="h-5 w-5 text-primary" />
                <p className="mt-2 font-medium">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
                <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
        </RevealSection>

        <RevealSection>
          <h2 className="text-xl font-medium">荒诞论文体，怎么写才像样</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              ['一句话命题', '先把荒诞命题压成一句话：如果 A 成立，世界会变成什么样。命题越清楚，正文越好笑。'],
              ['借真格式，不借假数据', '摘要、方法、讨论、参考文献都可以借；数据、实验、调查不能凭空捏造。'],
              ['论证要自洽', '荒诞不等于乱写。设定立住，推理一步一步走，结论才会响。'],
              ['留一个讨论口', '结尾别把话讲死，留一个问题或一个反例，让别人能接下去。'],
            ].map(([title, body]) => (
              <div key={title} className="border-t pt-3">
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </RevealSection>

        <RevealSection>
          <h2 className="flex items-center gap-2 text-xl font-medium">
            <ShieldCheck className="h-5 w-5 text-primary" />
            发布前，检查这四件事
          </h2>
          <div className="mt-4 divide-y border-y">
            {CHECKS.map(([title, body], index) => (
              <div key={title} className="flex gap-4 py-3.5">
                <span className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            更完整的版权、隐私与处理规则见
            <Link to="/guide" search={{ tab: 'policies' }} className="mx-1 text-primary hover:underline">
              论坛公约
            </Link>
            。
          </p>
        </RevealSection>

        <RevealSection className="border-t pt-6">
          <p className="font-serif text-xl">写不动的时候，先发一段。</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            论坛不要求一次写完。一个标题、一段引子、一个没想明白的问题，都可以先放上来；
            有人接，再继续写。
          </p>
        </RevealSection>
      </div>
    </div>
  )
}
