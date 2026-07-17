import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

export const Route = createFileRoute('/settings/provider/')({
  component: RouteComponent,
})

export function RouteComponent() {
  const isSmallScreen = useIsSmallScreen()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isSmallScreen) {
      navigate({ to: '/settings/provider/$providerId', params: { providerId: 'openai' }, replace: true })
    }
  }, [isSmallScreen, navigate])

  return null
}
