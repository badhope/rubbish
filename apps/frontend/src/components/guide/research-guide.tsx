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

const ENTRY_POINTS = [
  {
    icon: MessageSquare,
    title: '研究计划',
    body: '一个问题、为什么值得做、打算怎么做、可能需要谁来帮忙。先立项，再动手。',
    hint: '适合：找同伴、征求意见、预注册一个脑洞',
  },
  {
    icon: FileText,
    title: '实验与田野记录',
    body: '做了什么、用了什么材料、过程卡在哪里、观察到了什么。阶段记录也算数。',
    hint: '适合：实验日志、田野笔记、过程汇报',
  },
  {
    icon: PenLine,
    title: '失败复盘',
    body: '原计划是什么、实际发生了什么、偏差在哪、下一步怎么改。失败也是结果。',
    hint: '适合：踩坑、方法反思、负结果',
  },
]

const METHOD_POINTS = [
  ['问题压成一句话', '先写清楚“我想弄清楚什么”。问题越具体，别人越能接得住。'],
  ['设定要能站住', '荒诞研究也要有清楚的设定：在什么条件下，这个结论才成立。'],
  ['过程可以追踪', '材料、步骤、失败点尽量写出来；不需要漂亮，但要对得上。'],
  ['结论可以荒诞，引用不能伪造', '真实文献给得出处；自己编的参考文献，标注“虚构参考文献”。'],
]

const CHECKS = [
  ['标题能被检索', '用一句人话说明研究问题，不用“论”“浅析”开头堆三层。'],
  ['虚构要标出来', '荒诞研究、讽刺写作、思想实验，在标题区或正文开头写明“虚构创作”。'],
  ['材料能对上', '引用的文献、数据、图片给得出处；无法核查的材料，说明它只是设定。'],
  ['不碰真人隐私', '不点名真实个人、单位、病历、聊天记录；讽刺指向现象，不指向可识别的人。'],
]

export function ResearchGuide() {
  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to="/forum"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回社区
      </Link>

      <PageHeader
        title="研究指南"
        description="从一个问题开始，不必先有结论。这里只收能读、能聊、能继续做的研究记录。"
        actions={
          <Button asChild>
            <Link to="/forum" search={{ compose: '1' }}>
              去发布
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
            {ENTRY_POINTS.map(({ icon: Icon, title, body, hint }) => (
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
          <h2 className="text-xl font-medium">荒诞研究，怎么做得像样</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {METHOD_POINTS.map(([title, body]) => (
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
              社区公约
            </Link>
            。
          </p>
        </RevealSection>

        <RevealSection className="border-t pt-6">
          <p className="font-serif text-xl">做不动的时候，先发一个计划。</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            社区不要求一次做完。一个问题、一段过程、一次失败，都可以先放上来；
            有人接，再继续做。
          </p>
        </RevealSection>
      </div>
    </div>
  )
}
