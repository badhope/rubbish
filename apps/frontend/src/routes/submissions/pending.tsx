import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/submissions/pending')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/content' })
  },
})
