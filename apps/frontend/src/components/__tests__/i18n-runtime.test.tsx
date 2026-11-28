import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nRuntime } from '@/components/i18n-runtime'
import { setLang } from '@/lib/i18n'

function Field() {
  const [picked, setPicked] = useState(false)
  return (
    <div>
      <textarea placeholder={picked ? '关于这一段，你想问什么？' : '读完整篇，你想问什么？'} />
      <button type="button" aria-label={picked ? '已收藏，管理收藏' : '收藏'} onClick={() => setPicked(true)}>
        go
      </button>
      <blockquote data-i18n-skip aria-label="收藏">原文</blockquote>
    </div>
  )
}

const flush = () => act(async () => {
  // past the runtime's one-off first-frame pass, so only the observer can react afterwards
  await new Promise((resolve) => setTimeout(resolve, 40))
})

describe('I18nRuntime', () => {
  afterEach(() => setLang('zh'))

  it('re-translates an attribute every time React writes new source copy', async () => {
    setLang('en')
    const { container, getByText } = render(
      <>
        <I18nRuntime />
        <Field />
      </>,
    )
    await flush()
    const textarea = container.querySelector('textarea')!
    const button = getByText('go')
    expect(textarea.getAttribute('placeholder')).toBe('Having read the whole piece, what do you want to ask?')

    // Before the fix the element was marked "already translated" forever and
    // the second placeholder stayed in Chinese.
    await act(async () => button.click())
    await flush()
    expect(textarea.getAttribute('placeholder')).toBe('What do you want to ask about this passage?')
    expect(button.getAttribute('aria-label')).not.toMatch(/[一-鿿]/)

    // Author content stays as written.
    expect(container.querySelector('blockquote')!.getAttribute('aria-label')).toBe('收藏')

    // Switching back restores the newest Chinese source, not the first one.
    await act(async () => setLang('zh'))
    await flush()
    expect(textarea.getAttribute('placeholder')).toBe('关于这一段，你想问什么？')
  })
})
