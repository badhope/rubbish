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
    title: '选题与计划',
    body: '一个想讲清的问题、为什么值得写、打算怎么写、可能需要谁来补充。先列提纲，再动笔。',
    hint: '适合：找同伴、征求意见、把题目先立住',
  },
  {
    icon: FileText,
    title: '过程与现场记录',
    body: '做了什么、用了什么材料、过程卡在哪里、观察到了什么。阶段记录也能单独成文。',
    hint: '适合：写作日志、现场笔记、进度汇报',
  },
  {
    icon: PenLine,
    title: '失败与复盘',
    body: '原计划是什么、实际发生了什么、偏差在哪、下一步怎么改。失败也是结果。',
    hint: '适合：踩坑、方法反思、没做成的尝试',
  },
]

const METHOD_POINTS = [
  ['问题压成一句话', '先写清楚“我想讲明白什么”。问题越具体，别人越能接得住。'],
  ['设定要能站住', '荒诞写作也要有清楚的设定：在什么条件下，这个结论才成立。'],
  ['过程可以追踪', '材料、步骤、失败点尽量写出来；不需要漂亮，但要对得上。'],
  ['结论可以荒诞，引用不能伪造', '真实资料给得出处；自己编的参考资料，标注“虚构参考资料”。'],
]

const CHECKS = [
  ['标题要说人话', '用一句人话说明你要讲的事，不用“论”“浅析”这类官腔开头。'],
  ['虚构要标出来', '荒诞写作、讽刺写作、思想实验，在标题区或正文开头写明“虚构创作”。'],
  ['材料能对上', '引用的资料、数据、图片给得出处；无法核查的材料，说明它只是设定。'],
  ['不碰真人隐私', '不点名真实个人、单位、病历、聊天记录；讽刺指向现象，不指向可识别的人。'],
]

export function ResearchGuide() {
  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to="/catalog"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        返回内容库
      </Link>

      <PageHeader
        title="写一篇"
        description="从一个问题开始，不必先有答案。写清楚你想讲什么；写不完，也可以先放一段上来。"
        actions={
          <Button asChild>
            <Link to="/submissions/new">
              开始写
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
          <h2 className="text-xl font-medium">荒诞写作，怎么做得像样</h2>
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
            放上来前，检查这四件事
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
              边界与处理
            </Link>
            。
          </p>
        </RevealSection>

        <RevealSection className="border-t pt-6">
          <p className="font-serif text-xl">做不动的时候，先写一篇短文。</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            社区不要求一次写完。一个问题、一段过程、一次失败，都可以先放上来；
            有人接，再继续写。
          </p>
        </RevealSection>
      </div>
    </div>
  )
}
