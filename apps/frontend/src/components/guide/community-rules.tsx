import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  Copyright,
  EyeOff,
  FileWarning,
  Gavel,
  HeartHandshake,
  Lock,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { RevealSection } from '@/components/common/reveal-section'
import { Card, CardContent } from '@/components/ui/card'

// 社区公约：研究标注、版权、真人隐私、内容边界、举报处理。
// 只写一个荒诞科研社区怎么运转。
const SECTIONS = [
  {
    icon: Sparkles,
    title: '这是一个社区',
    body: [
      'Rubbish 是一个荒诞科研社区：帖子做讨论，文章走投稿，注册后就能发。',
      '研究可以荒诞，方法要能对上：问题、设定、过程、材料尽量写清楚。',
      '我们欢迎选题与计划、过程记录、现场观察、失败复盘、讽刺写作和思想实验；也欢迎只发一个问题，让别人接着聊。',
    ],
  },
  {
    icon: FileWarning,
    title: '虚构标注与内容边界',
    body: [
      '荒诞研究、讽刺写作、思想实验必须在标题区或正文开头显著标注“虚构创作 / 讽刺文学”。',
      '虚构内容不得冒充真实研究、真实调查、真实临床或真实实验；不得伪造数据、机构公章、审批文件或冒充真实研究项目。',
      '不点名真实人物、机构、学校、医院、公司；如确需引用公开事实，只做中性描述，不做人身攻击或影射。',
      '不发布违法内容、暴力煽动、仇恨言论、色情内容、未成年人不宜内容，也不提供医疗、法律、金融等专业建议。',
    ],
  },
  {
    icon: Copyright,
    title: '版权与引用',
    body: [
      '作者保留作品著作权；发布即授予社区非独占的展示、存储、索引与备份许可，作者可随时申请删除或更正。',
      '转载、翻译、改编他人作品必须获得授权并注明来源；图片、表格、长段引用不得超过合理使用范围。',
      '引用真实文献可以，但不得把虚构参考文献伪装成真实文献；参考文献只作为写作道具时，请在文末统一注明“虚构参考文献”。',
      '发现抄袭、洗稿、盗图或未经授权的搬运，社区会下架内容并保留处理记录。',
    ],
  },
  {
    icon: EyeOff,
    title: '真人、隐私与名誉',
    body: [
      '不披露他人真实姓名、联系方式、住址、单位、病历、聊天记录或其他可识别信息。',
      '不捏造事实贬损真实人物或群体；讽刺应指向观点、现象与结构，不指向可被识别的个人。',
      '涉及真实事件时，只讨论公开信息；不鼓励人肉、围观、骚扰或跨平台围攻。',
      '收到隐私或名誉投诉后，社区可先隐藏内容再核查；作者可提交反证申诉。',
    ],
  },
  {
    icon: Gavel,
    title: '社区行为',
    body: [
      '尊重每一位参与者：不人身攻击、不地域歧视、不骚扰、不恶意引战；批评针对作品，不针对作者。',
      '账户不得出售、转让或冒用他人身份；用户名不得含侮辱性、冒充官方或误导性词汇。',
      '不刷屏、不批量灌水、不发布广告或引流内容；重复帖会被合并或移除。',
      '违规处理按情节轻重：提醒 → 限制发帖 → 隐藏内容 → 封禁账号；严重违规保留审计记录。',
    ],
  },
  {
    icon: ShieldAlert,
    title: '举报与处理',
    body: [
      '帖子、回复、用户主页均有举报入口；举报时请选择类型并写清理由，恶意举报也会被处理。',
      '版权、隐私、名誉与违法内容优先处理；社区通常在 7 个工作日内给出处理结果。',
      '被处理内容作者可申诉一次；申诉期间不重复发布同一内容。',
      '涉及司法机关、监管机构或平台投诉的，社区会按法律要求配合并提供必要记录。',
    ],
  },
  {
    icon: Lock,
    title: '数据与隐私',
    body: [
      '社区只收集账号运行所必需的数据：邮箱、登录记录、发帖与互动内容。',
      '不出售用户数据，不投放第三方跟踪广告；阅读记录仅用于进度与推荐，可在个人设置中清除。',
      '服务器与域名位于香港；跨境访问与数据存储按实际服务区域处理。',
      '完整隐私条款以站内隐私页为准；数据删除请求可发邮件到 info@rubbishasci.cn。',
    ],
  },
  {
    icon: Trash2,
    title: '删除、更正与退出',
    body: [
      '作者可随时删除自己的作品；被删除后，站内链接失效，搜索引擎缓存由各搜索引擎自行更新。',
      '发现事实错误时优先更正；涉及侵权或隐私的内容可直接下架。',
      '账号可申请注销；注销后公开内容会去标识化，法律要求保留的记录除外。',
    ],
  },
  {
    icon: HeartHandshake,
    title: '不承诺什么',
    body: [
      '不承诺任何机构认证、职称认定、学分、奖项或官方背书；站内记录不能替代正式学历、执业或出版材料。',
      '不承诺内容永久在线；社区会做备份，但不对第三方存档、搜索引擎快照或转载负责。',
      '不承诺“零风险”：所有内容由作者与社区共同维护，最终以适用法律与社区规则为准。',
    ],
  },
]

export function CommunityRules() {
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
        title="社区公约"
        description="研究标注、版权、真人隐私、内容边界与举报处理——这个社区怎么运转，写在这里。"
      />

      <div className="space-y-6">
        {SECTIONS.map(({ icon: Icon, title, body }) => (
          <RevealSection key={title}>
            <Card>
              <CardContent className="p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
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
              </CardContent>
            </Card>
          </RevealSection>
        ))}

        <RevealSection as="p" className="border-t pt-6 text-xs leading-relaxed text-muted-foreground">
          公约更新会在本页与站内公告同步注明日期；重大变更提前 14 天公示。
          完整隐私条款见
          <a href="/privacy" className="mx-1 text-primary hover:underline">
            隐私政策
          </a>
          。
        </RevealSection>
      </div>
    </div>
  )
}
