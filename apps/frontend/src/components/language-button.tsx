import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setLang, useLang } from '@/lib/i18n'

/**
 * One visible switch, not a buried setting. Chinese is the source language;
 * English is the curated reading language. The button always says which side
 * you would move to, so it never reads as a status badge.
 */
export function LanguageButton() {
  const lang = useLang()
  const next = lang === 'zh' ? 'en' : 'zh'

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setLang(next)}
      className="h-9 shrink-0 gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      aria-label={lang === 'zh' ? '切换到英文 / Switch to English' : '切换回中文 / Switch to Chinese'}
      title={lang === 'zh' ? 'Switch to English' : 'Switch to Chinese'}
    >
      <Languages className="h-4 w-4" aria-hidden />
      <span>{lang === 'zh' ? 'EN' : '中文'}</span>
    </Button>
  )
}
