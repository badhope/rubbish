import { createFileRoute, redirect } from '@tanstack/react-router'
import { requireAdminGuard } from '@/lib/route-guards'

export const Route = createFileRoute('/admin/journal')({
  beforeLoad: () => {
    requireAdminGuard()
    throw redirect({ to: '/admin/content' })
  },
})
