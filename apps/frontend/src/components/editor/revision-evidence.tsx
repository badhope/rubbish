import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  useSubmissionVersionDiff,
  useSubmissionVersions,
} from '@/hooks/api/use-modules'
import type { SubmissionResponse } from '@/lib/types'
import { formatDateTime } from '@/lib/utils'
import { isRevisionSubmission } from '@/lib/revision'

/**
 * 返修稿核对块：作者回应、本版修改说明、按需展开的实际 diff。
 *
 * 决定弹层必须在同一个位置展示这三样材料，避免“直接录用”只凭版本号。
 * diff 默认不请求，只有主编主动展开时才拉取版本快照。
 */
export function RevisionEvidencePanel({
  submission,
}: {
  submission: SubmissionResponse
}) {
  const isRevision = isRevisionSubmission(submission.latest_version)
  const [diffOpen, setDiffOpen] = useState(false)
  const versionsQ = useSubmissionVersions(submission.id, isRevision)
  const latestNote =
    versionsQ.data?.find((v) => v.version === submission.latest_version)?.note ?? ''
  const diffQ = useSubmissionVersionDiff(
    submission.id,
    isRevision ? (submission.latest_version ?? 0) : 0,
    isRevision && diffOpen,
  )

  if (!isRevision) return null

  return (
    <div className="space-y-2 rounded-md border border-violet-200 bg-violet-500/5 p-3 dark:border-violet-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-violet-700 dark:text-violet-300">
          作者修回材料（v{submission.latest_version}）
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={() => setDiffOpen((v) => !v)}
        >
          {diffOpen ? '收起实际改动' : '查看实际改动'}
        </Button>
      </div>

      {submission.author_response ? (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">
            对上一轮意见的回应
            {submission.author_response_at
              ? ` · ${formatDateTime(submission.author_response_at)}`
              : ''}
          </div>
          <p className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded bg-background/70 p-2 text-xs leading-relaxed">
            {submission.author_response}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          作者没有单独填写对上一轮意见的回应。
        </p>
      )}

      {versionsQ.isLoading ? (
        <p className="text-xs text-muted-foreground">正在读取版本历史…</p>
      ) : versionsQ.isError ? (
        <p className="text-xs text-destructive">
          版本历史读取失败，可去稿件详情核对后再决定。
        </p>
      ) : latestNote ? (
        <div className="space-y-1">
          <div className="text-[11px] font-medium text-muted-foreground">
            本版修改说明
          </div>
          <p className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded bg-background/70 p-2 text-xs leading-relaxed">
            {latestNote}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          本版没有填写修改说明。
          {!submission.author_response ? '请展开“实际改动”核对后再决定是否直接录用。' : ''}
        </p>
      )}

      {diffOpen && (
        <div className="space-y-2 rounded border bg-background/80 p-2">
          {diffQ.isLoading ? (
            <p className="text-xs text-muted-foreground">正在读取版本对比…</p>
          ) : diffQ.isError ? (
            <p className="text-xs text-destructive">
              版本对比读取失败，可去详情版本历史核对
            </p>
          ) : diffQ.data ? (
            <>
              {diffQ.data.field_changes.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium">题录字段变化</div>
                  {diffQ.data.field_changes.map((change) => (
                    <div
                      key={change.field}
                      className="rounded bg-muted/50 px-2 py-1 text-[11px]"
                    >
                      <span className="font-medium">{change.field}</span>：{' '}
                      <span className="text-muted-foreground line-through">
                        {String(change.before ?? '—').slice(0, 80)}
                      </span>{' '}
                      → {String(change.after ?? '—').slice(0, 80)}
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-1">
                <div className="text-[11px] font-medium">正文差异</div>
                {diffQ.data.body_diff.length > 0 ? (
                  <pre className="max-h-56 overflow-auto rounded border bg-muted/40 p-2 text-[11px] leading-relaxed">
                    {diffQ.data.body_diff.map((line, index) => (
                      <div
                        key={`${index}-${line.slice(0, 12)}`}
                        className={
                          line.startsWith('+')
                            ? 'text-emerald-700'
                            : line.startsWith('-')
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                        }
                      >
                        {line || ' '}
                      </div>
                    ))}
                  </pre>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    这一版没有可比对的正文快照。
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
