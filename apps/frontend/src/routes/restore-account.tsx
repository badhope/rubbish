import { createFileRoute } from '@tanstack/react-router'
import { RestoreAccountPage } from '@/components/auth/restore-account-page'

export const Route = createFileRoute('/restore-account')({
  component: RestoreAccountPage,
})
