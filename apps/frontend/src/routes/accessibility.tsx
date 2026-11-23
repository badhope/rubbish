import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, Eye, Keyboard, Palette, Type, Image as ImageIcon, MessageSquareWarning } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { RevealSection } from '@/components/common/reveal-section'

export const Route = createFileRoute('/accessibility')({
  component: AccessibilityPage,
})

const SECTIONS = [
  {
    icon: Keyboard,
    title: '键盘与焦点',
    body: [
      '导航、按钮、表单和弹窗都可以只用键盘操作；Tab 按页面顺序移动，Shift+Tab 回退。',
      '当前焦点有可见的描边环；弹窗打开后焦点留在弹窗内，Esc 关闭并回到触发处。',
      '每个公开页头部都有「跳到主要内容」链接，键盘用户可以跳过重复导航。',
    ],
  },
  {
    icon: Eye,
    title: '读屏与语义',
    body: [
      '页面按标题层级组织；图标按钮带文字标签，纯装饰的图标不读给屏幕阅读器。',
      '每个输入框都有关联的标签；状态变化同时用文字说明，不只靠颜色区分。',
      '作品正文与话题正文保留作者原文；站方只调整字体回退与标题层级。',
    ],
  },
  {
    icon: Palette,
    title: '颜色与对比',
    body: [
      '正文与背景的对比按 4.5:1 以上控制；亮色、暗色和四套身份色都走同一组语义色。',
      '状态同时配有图标与文字（成功、警示、失败），不靠红绿单独传意。',
      '外观菜单可以切换亮色、暗色与跟随系统；设置留在本机。',
    ],
  },
  {
    icon: Type,
    title: '文字与排版',
    body: [
      '正文使用系统无衬线字体栈，标题使用衬线回退；浏览器放大到 200% 时正文仍可换行阅读。',
      '长标题、长链接和长用户名在窄屏折行，不会被截断或横向撑开页面。',
      '移动正文按 15–16px 渲染；辅助文字不小于 11px。',
    ],
  },
  {
    icon: ImageIcon,
    title: '图片与媒体',
    body: [
      '封面图未加载时有占位底；图片加载失败不会留下破图空位。',
      '作品内图片由作者提供，替代文本以正文出处说明为准。',
    ],
  },
  {
    icon: MessageSquareWarning,
    title: '已知限制',
    body: [
      '公式依赖 KaTeX 渲染；不支持时以源码文本为准。',
      '后台图表由 ECharts 绘制，对应数据在页面文字列表里也能读到。',
      '部分历史内容的标题层级仍在梳理；遇到读屏顺序不对的页面，欢迎反馈。',
    ],
  },
]

function AccessibilityPage() {
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
        title="可访问性说明"
        description="这张桌子对键盘、读屏和放大阅读开放；下面写清已经做到什么、哪里还没做好。"
      />

      <div className="space-y-8">
        {SECTIONS.map(({ icon: Icon, title, body }) => (
          <RevealSection key={title}>
            <h2 className="flex items-center gap-2 text-lg font-medium">
              <Icon className="h-5 w-5 text-primary" />
              {title}
            </h2>
            <ul className="mt-3 space-y-2">
              {body.map((line) => (
                <li key={line} className="text-sm leading-relaxed text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
          </RevealSection>
        ))}

        <RevealSection className="border-t pt-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            键盘操作、读屏朗读或颜色对比遇到问题，可以在
            <Link to="/forum" search={{ view: 'feedback' }} className="mx-1 text-primary hover:underline">
              反馈墙
            </Link>
            选择「无障碍与移动端问题」留言，或写信到 info@rubbishasci.cn。站务会尽快处理。
          </p>
        </RevealSection>
      </div>
    </div>
  )
}
