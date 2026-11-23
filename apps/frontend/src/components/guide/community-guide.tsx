import { Link } from '@tanstack/react-router'
import { ArrowRight, Bookmark, Flag, Keyboard, LogIn, MessagesSquare, PenLine, Settings } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { RevealSection } from '@/components/common/reveal-section'
import { Button } from '@/components/ui/button'

const STEPS = [
  {
    icon: MessagesSquare,
    title: '先读',
    body: '登录后先读话题和公开作品。遇到想接的话，可以直接回应。',
  },
  {
    icon: LogIn,
    title: '登录',
    body: '邮箱验证码或密码都行。登录后才有说话、回应、收藏和举报入口。',
  },
  {
    icon: PenLine,
    title: '说话',
    body: '点讨论区的「说一句」，选分区、写标题、写正文。标题按回车会跳到正文；长文请走写一篇入口。',
  },
  {
    icon: Keyboard,
    title: '继续接',
    body: '正文写完后按 Ctrl / ⌘ + Enter 发出；也可以点底部「说一句」。发完还能回来补记录。',
  },
]

const BASICS = [
  ['分区怎么选', '选最具体的子分区；父分区会自动汇总子分区的话题。拿不准就选「站务与反馈」问一句。'],
  ['草稿在哪', '编辑器会自动把标题和正文存在本机浏览器；换设备不会同步，发布前别清站点数据。'],
  ['图片和表情', '正文下方有「表情」和「图片」；图片会传到站内存储，正文里只留一个链接。'],
  ['编辑和删除', '自己的话题可以在详情页编辑；被站务锁定后不能再改，但可以继续读。'],
  ['收藏和关注', '话题右上角收藏；作者主页可以关注。关注后新回应会进你的通知与推荐。'],
  ['举报', '话题、回应、成员主页都有举报入口。选类型、写理由，站务会在后台处理。'],
]

export function CommunityGuide() {
  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to="/forum"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowRight className="mr-1 h-4 w-4 rotate-180" />
        返回讨论区
      </Link>

      <PageHeader
        headingLevel={2}
        title="在讨论区说话"
        description="从读到说，四步就够。登录即可说话，不必先申请。"
        actions={
          <Button asChild>
            <Link to="/forum" search={{ compose: 1 }}>
              说一句
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <div className="space-y-10">
        <RevealSection>
          <div className="grid gap-4 sm:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="border-t pt-4">
                <Icon className="h-5 w-5 text-primary" />
                <p className="mt-2 text-sm font-medium">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </RevealSection>

        <RevealSection>
          <h2 className="text-xl font-medium">几个常问的事</h2>
          <div className="mt-4 divide-y border-y">
            {BASICS.map(([title, body]) => (
              <div key={title} className="grid gap-1 py-3.5 sm:grid-cols-[8rem_1fr] sm:gap-4">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </RevealSection>

        <RevealSection>
          <h2 className="text-xl font-medium">这里谁在管</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              ['举报处理', '站务按类型分派：隐私与侵权优先，广告和灌水其次。处理结果会留在审计记录里。'],
              ['内容维护', '合并重复话题、移到其他分区、锁定争执话题；不替作者改正文。'],
              ['规则变更', '边界与处理更新会发公告；规则变更提前 14 天公示。'],
            ].map(([title, body]) => (
              <div key={title} className="border-t pt-3">
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </RevealSection>

        <RevealSection className="flex flex-wrap gap-4 border-t pt-5 text-sm">
          <Link to="/forum" className="inline-flex items-center gap-1 text-primary hover:underline">
            <MessagesSquare className="h-4 w-4" /> 回讨论区
          </Link>
          <Link to="/guide" search={{ tab: 'authors' }} className="inline-flex items-center gap-1 text-primary hover:underline">
            <PenLine className="h-4 w-4" /> 写一篇
          </Link>
          <Link to="/guide" search={{ tab: 'policies' }} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Flag className="h-4 w-4" /> 边界与处理
          </Link>
          <Link to="/me" className="inline-flex items-center gap-1 text-primary hover:underline">
            <Bookmark className="h-4 w-4" /> 我的收藏
          </Link>
          <Link to="/me" search={{ tab: 'settings' }} className="inline-flex items-center gap-1 text-primary hover:underline">
            <Settings className="h-4 w-4" /> 设置
          </Link>
        </RevealSection>
      </div>
    </div>
  )
}
