import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Prefs = {
  in_app_comment: boolean
  in_app_forum: boolean
  in_app_review: boolean
  in_app_submission: boolean
  in_app_release: boolean
  in_app_publication: boolean
  email_comment: boolean
  email_forum: boolean
  email_review: boolean
  email_submission: boolean
  email_release: boolean
}

type PrefKey = keyof Prefs
type PrefRow = { key: PrefKey; label: string; hint: string }

const IN_APP_ROWS: PrefRow[] = [
  { key: 'in_app_comment', label: '记录评论', hint: '有人评论你发布的记录时，在站内通知你' },
  { key: 'in_app_forum', label: '楼层互动', hint: '有人回应你的主题帖时，在站内通知你' },
  {
    key: 'in_app_review',
    label: '互评与核对',
    hint: '收到互评邀请、催办提醒或核对邀请时，在站内通知你',
  },
  {
    key: 'in_app_submission',
    label: '作品处理',
    hint: '作品进入初筛、被退回修改或收到处理结果时，在站内通知你',
  },
  {
    key: 'in_app_release',
    label: '发布失败告警',
    hint: '定时发布失败时，在站内通知负责这件作品的内容整理',
  },
  {
    key: 'in_app_publication',
    label: '作品公开与更正',
    hint: '你关注的作品公开、更正或撤回署名时，在站内通知你；默认开启',
  },
]

const EMAIL_ROWS: PrefRow[] = [
  { key: 'email_comment', label: '记录评论邮件', hint: '额外发一封邮件；默认关闭' },
  { key: 'email_forum', label: '讨论回复邮件', hint: '额外发一封邮件；默认关闭' },
  {
    key: 'email_review',
    label: '互评与核对邮件',
    hint: '互评邀请、催办和核对邀请的邮件副本；默认开启',
  },
  {
    key: 'email_submission',
    label: '作品处理邮件',
    hint: '作品处理结果与检查超时提醒；默认开启',
  },
  {
    key: 'email_release',
    label: '发布与作品汇总邮件',
    hint: '发布失败告警，以及你关注作者/学科的每日新作汇总；默认开启',
  },
]

function PrefSection({
  title,
  note,
  rows,
  prefs,
  onChange,
}: {
  title: string
  note: string
  rows: PrefRow[]
  prefs: Prefs
  onChange: (key: PrefKey, checked: boolean) => void
}) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <label
            key={row.key}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[#2f5d46]"
              checked={prefs[row.key]}
              onChange={(e) => onChange(row.key, e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{row.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                {row.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  )
}

export function NotificationPrefsCard() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .get<Prefs>('/users/me/notification-preferences')
      .then((res) => {
        if (alive) setPrefs(res.data)
      })
      .catch(() => {
        if (alive) toast.error('通知偏好加载失败，可再试一次。')
      })
    return () => {
      alive = false
    }
  }, [])

  async function save() {
    if (!prefs) return
    setSaving(true)
    try {
      const res = await api.patch<Prefs>('/users/me/notification-preferences', prefs)
      setPrefs(res.data)
      toast.success('通知偏好已保存')
    } catch {
      toast.error('通知偏好保存失败，可再试一次。')
    } finally {
      setSaving(false)
    }
  }

  function toggle(key: PrefKey, checked: boolean) {
    setPrefs((prev) => (prev ? { ...prev, [key]: checked } : prev))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>通知偏好</CardTitle>
        <CardDescription>
          站内通知即时到达；邮件是额外副本。评论与讨论回复邮件默认关闭，互评、作品处理、发布失败邮件默认开启。未配置
          SMTP 时只记录为“未发送”，不会假装送达。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!prefs ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : (
          <>
            <PrefSection
              title="站内通知"
              note="只收和你有关的提醒；关掉后不会在铃铛里出现，但对应页面仍可处理。"
              rows={IN_APP_ROWS}
              prefs={prefs}
              onChange={toggle}
            />
            <PrefSection
              title="邮件副本"
              note="需要站点配置 SMTP 才会真正送达；发给你的每一类邮件都可以单独关闭。"
              rows={EMAIL_ROWS}
              prefs={prefs}
              onChange={toggle}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                自己评论/回复自己的内容不会触发通知。
              </p>
              <Button onClick={save} disabled={saving} size="sm">
                {saving ? '保存中…' : '保存偏好'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
