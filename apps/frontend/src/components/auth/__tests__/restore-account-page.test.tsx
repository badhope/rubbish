import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RestoreAccountPage } from '../restore-account-page'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  logout: vi.fn(),
  clearRestoreToken: vi.fn(),
  restoreMutate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: unknown }) => children,
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector: (state: { logout: () => void }) => unknown) =>
    selector({ logout: mocks.logout }),
}))

vi.mock('@/lib/restore-token', () => ({
  loadRestoreToken: () => 'old-token',
  clearRestoreToken: mocks.clearRestoreToken,
}))

vi.mock('@/hooks/api/use-auth', () => ({
  useRestoreMyAccount: () => ({ mutate: mocks.restoreMutate, isPending: false }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('RestoreAccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.restoreMutate.mockImplementation((_body, options) => {
      options?.onSuccess?.()
    })
  })

  it('submits the recovery token with the new identity', () => {
    render(<RestoreAccountPage />)
    fireEvent.change(screen.getByLabelText('新的邮箱'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('新的用户名'), { target: { value: 'new_name' } })
    fireEvent.change(screen.getByLabelText('新的密码'), { target: { value: 'NewPass123!' } })
    fireEvent.click(screen.getByRole('button', { name: '恢复账号' }))

    expect(mocks.restoreMutate).toHaveBeenCalledWith(
      {
        token: 'old-token',
        email: 'new@example.com',
        username: 'new_name',
        new_password: 'NewPass123!',
      },
      expect.any(Object),
    )
    expect(mocks.clearRestoreToken).toHaveBeenCalled()
    expect(mocks.logout).toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/login' })
  })
})
