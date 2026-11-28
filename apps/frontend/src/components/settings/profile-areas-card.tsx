import { useState } from 'react'
import { PenLine, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useUpdateProfile } from '@/hooks/api/use-auth'
import { extractError } from '@/lib/utils'
import type { UserProfileUpdate, UserResponse } from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DisciplinePicker } from './discipline-picker'

/** 把“我写什么”和“我能评什么”分开：前者公开，后者只进互评匹配。 */
const parseTags = (value: string) =>
  value
    .split(/[,，;；、\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20)

export function ProfileAreasCard({ initial }: { initial?: UserResponse | null }) {
  const updateProfile = useUpdateProfile()
  const savedSubjects = initial?.subject_disciplines ?? []
  const savedReviewer = initial?.reviewer_disciplines ?? []
  const savedTags = initial?.reviewer_tags ?? []
  const [subjects, setSubjects] = useState<string[]>(savedSubjects)
  const [reviewer, setReviewer] = useState<string[]>(savedReviewer)
  const [tags, setTags] = useState(savedTags.join('、'))
  const parsedTags = parseTags(tags)

  const dirty =
    JSON.stringify([...subjects].sort()) !== JSON.stringify([...savedSubjects].sort()) ||
    JSON.stringify([...reviewer].sort()) !== JSON.stringify([...savedReviewer].sort()) ||
    JSON.stringify(parsedTags) !== JSON.stringify(savedTags)

  const save = async () => {
    const body: UserProfileUpdate = {}
    if (JSON.stringify([...subjects].sort()) !== JSON.stringify([...savedSubjects].sort())) {
      body.subject_disciplines = subjects
    }
    if (JSON.stringify([...reviewer].sort()) !== JSON.stringify([...savedReviewer].sort())) {
      body.reviewer_disciplines = reviewer
    }
    if (JSON.stringify(parsedTags) !== JSON.stringify(savedTags)) {
      body.reviewer_tags = parsedTags
    }
    if (Object.keys(body).length === 0) return
    try {
      await updateProfile.mutateAsync(body)
      if (body.subject_disciplines) setSubjects(body.subject_disciplines)
      if (body.reviewer_disciplines) setReviewer(body.reviewer_disciplines)
      if (body.reviewer_tags) setTags(body.reviewer_tags.join('、'))
      toast.success('领域资料已保存', { id: 'profile-areas-save' })
    } catch (err) {
      toast.error(extractError(err, '领域资料没保存成功，可再试一次'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PenLine className="h-4 w-4 text-primary" />
          领域与互评
        </CardTitle>
        <CardDescription>
          科目领域会出现在公开主页；审稿人领域与审稿能力标签只用于互评匹配和站务审阅，不对外展示。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <DisciplinePicker
            label="科目领域"
            value={subjects}
            onChange={setSubjects}
            max={6}
            helper="你写作、研究或长期关注的方向，公开主页会显示这些标签。"
          />
          <DisciplinePicker
            label="审稿人领域"
            value={reviewer}
            onChange={setReviewer}
            max={10}
            helper="你能判断的稿件方向。只参与互评候选匹配和站务审阅，不展示给作者。"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-reviewer-tags">审稿能力标签</Label>
          <Input
            id="profile-reviewer-tags"
            value={tags}
            maxLength={300}
            placeholder="如：质性研究、田野调查、统计分析、代码复现"
            onChange={(e) => setTags(e.target.value)}
          />
          <p className="text-[11px] leading-5 text-muted-foreground">
            用顿号、逗号或分号分隔，最多 20 个。适合补充词表里没有的细分能力；同样不会出现在公开主页。
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            审稿人领域只给匹配与站务看；公开主页只看得到科目领域。
          </p>
          <Button size="sm" onClick={() => void save()} disabled={!dirty || updateProfile.isPending}>
            {updateProfile.isPending ? '保存中…' : '保存领域'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
