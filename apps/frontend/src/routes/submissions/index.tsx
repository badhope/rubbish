import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/submissions/')({
  beforeLoad: () => {
    throw redirect({ to: '/forum' })
  },
})
