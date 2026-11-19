import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/submissions/new')({
  beforeLoad: () => {
    throw redirect({ to: '/forum', search: { compose: '1' } })
  },
})
