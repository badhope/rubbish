import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/shop')({
  beforeLoad: () => {
    throw redirect({ to: '/me', search: { tab: 'coins' } })
  },
  component: () => null,
})
