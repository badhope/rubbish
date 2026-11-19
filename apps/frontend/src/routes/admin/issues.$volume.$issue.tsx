import { createFileRoute, redirect } from '@tanstack/react-router'
import { requireAdminGuard } from '@/lib/route-guards'

export const Route = createFileRoute('/admin/issues/$volume/$issue')({
  beforeLoad: () => {
    requireAdminGuard()
    throw redirect({ to: '/admin/content' })
  },
})
