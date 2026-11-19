import { useEffect, useRef, useState, type RefObject } from 'react'
import MDEditor, { commands } from '@uiw/react-md-editor'
import { ImagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmojiStickerPicker } from '@/components/common/emoji-sticker-picker'
import { cn } from '@/lib/utils'
import '@uiw/react-md-editor/markdown-editor.css'
import '@uiw/react-markdown-preview/markdown.css'

/**
 * 论坛编辑器：基于开源 @uiw/react-md-editor，不再维护自绘 toolbar。
 * 只保留发帖所需的高频命令，表情与图片上传放在底部一行，移动端优先聚焦正文。
 */
export function ForumEditor({
  value,
  onChange,
  placeholder,
  minHeight = 240,
  disabled,
  onUploadImage,
  onSubmitShortcut,
  autoFocus,
  textareaRef,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  minHeight?: number
  disabled?: boolean
  onUploadImage?: (file: File) => Promise<string>
  onSubmitShortcut?: () => void
  autoFocus?: boolean
  textareaRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const innerRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light')
  const [uploading, setUploading] = useState(false)

  const heading2 = {
    ...commands.title2,
    icon: <span className="text-[11px] font-semibold">H2</span>,
    buttonProps: { ...commands.title2.buttonProps, 'aria-label': '二级标题', title: '二级标题' },
  }

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setColorMode(root.classList.contains('dark') ? 'dark' : 'light')
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const textarea = containerRef.current?.querySelector('textarea') ?? null
    innerRef.current = textarea
    if (textareaRef) textareaRef.current = textarea
    if (autoFocus) textarea?.focus()
  }, [autoFocus, textareaRef])

  const insertText = (before: string, after = '') => {
    const el = innerRef.current
    if (!el) {
      onChange(value + before + after)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end)
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const cursor = start + before.length + selected.length
      el.setSelectionRange(cursor, cursor)
    })
  }

  const uploadImage = async (file: File) => {
    if (!onUploadImage) return
    setUploading(true)
    try {
      const url = await onUploadImage(file)
      insertText(`![图片](${url})`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className={cn('forum-md-editor', disabled && 'pointer-events-none opacity-70')}
      ref={containerRef}
      data-color-mode={colorMode}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          onSubmitShortcut?.()
        }
      }}
    >
      <MDEditor
        value={value}
        onChange={(next) => onChange(next ?? '')}
        preview="edit"
        height={minHeight}
        visibleDragbar={false}
        textareaProps={{
          placeholder,
          'aria-label': '帖子正文',
          autoFocus,
        }}
        commands={[
          heading2,
          commands.bold,
          commands.italic,
          commands.quote,
          commands.unorderedListCommand,
          commands.orderedListCommand,
          commands.link,
        ]}
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <EmojiStickerPicker onInsert={(text) => insertText(text)} disabled={disabled} />
        {onUploadImage ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void uploadImage(file)
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1.5 text-xs text-muted-foreground"
              disabled={disabled || uploading}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {uploading ? '上传中…' : '图片'}
            </Button>
          </>
        ) : null}
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {value.length} 字
        </span>
      </div>
    </div>
  )
}
