import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReasonDialog } from '../reason-dialog'

function renderDialog(onConfirm: (reason: string) => void) {
  render(
    <ReasonDialog
      open
      title="回滚发布时间线"
      label="回滚原因"
      defaultValue=""
      minLength={3}
      onConfirm={onConfirm}
      onOpenChange={() => {}}
    />,
  )
  return screen.getByLabelText('回滚原因') as HTMLTextAreaElement
}

describe('ReasonDialog', () => {
  it('原因不足最少字数时不能提交，补足后提交原因', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const field = renderDialog(onConfirm)

    await user.type(field, 'ab')
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()

    await user.type(field, 'c')
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(onConfirm).toHaveBeenCalledWith('abc')
  })

  it('提交前去掉原因首尾空格', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const field = renderDialog(onConfirm)

    fireEvent.change(field, { target: { value: '  恢复上一版  ' } })
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(onConfirm).toHaveBeenCalledWith('恢复上一版')
  })
})
