import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { AccountDataCard } from '../account-data-card'

const mocks = vi.hoisted(() => ({
  deleteMutate: vi.fn(),
  navigate: vi.fn(),
  logout: vi.fn(),
  saveRestoreToken: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: {
    getState: () => ({ token: 'old-token', logout: mocks.logout }),
  },
}))

vi.mock('@/lib/restore-token', () => ({
  saveRestoreToken: mocks.saveRestoreToken,
}))

vi.mock('@/hooks/api/use-auth', () => ({
  useExportMyData: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteMyAccount: () => ({ mutate: mocks.deleteMutate, isPending: false }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('AccountDataCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteMutate.mockImplementation((_body, options) => {
      options?.onSuccess?.({ restore_token: 'restore-only', hard_delete_after: '2026-12-22T00:00:00Z' })
    })
  })

  it('requires the password and literal phrase before deletion', () => {
    render(<AccountDataCard username="tester" />)
    fireEvent.click(screen.getByRole('button', { name: '注销账号' }))

    const confirm = screen.getByRole('button', { name: '确认注销' })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('输入「DELETE MY ACCOUNT」'), {
      target: { value: 'delete my account' },
    })

    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    expect(mocks.deleteMutate).toHaveBeenCalledWith(
      { password: 'secret', confirmation: 'DELETE MY ACCOUNT' },
      expect.any(Object),
    )
    expect(mocks.saveRestoreToken).toHaveBeenCalledWith('restore-only', '2026-12-22T00:00:00Z')
    expect(mocks.logout).toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/restore-account' })
  })

  it('never submits with the phrase alone', () => {
    render(<AccountDataCard username="tester" />)
    fireEvent.click(screen.getByRole('button', { name: '注销账号' }))
    fireEvent.change(screen.getByLabelText('输入「DELETE MY ACCOUNT」'), {
      target: { value: 'DELETE MY ACCOUNT' },
    })
    expect(screen.getByRole('button', { name: '确认注销' })).toBeDisabled()
  })
})
