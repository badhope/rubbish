import { useLang } from '@/lib/i18n'

/**
 * Marks around a work's name in interface copy: 《》 in Chinese, curly quotes
 * in English. The title inside stays exactly as its author wrote it.
 */
export function useTitleMarks(): [string, string] {
  return useLang() === 'en' ? ['“', '”'] : ['《', '》']
}
