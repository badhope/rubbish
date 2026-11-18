import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/levels')({
  beforeLoad: () => {
    throw redirect({ to: '/me', search: { tab: 'coins', section: 'levels' } })
  },
  component: () => null,
})
