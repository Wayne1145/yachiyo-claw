import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useInAndroidAppShell } from '@/components/yachiyo/AndroidAppShellContext'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

export const Route = createFileRoute('/settings/provider/')({
  component: RouteComponent,
})

export function RouteComponent() {
  const inAndroidAppShell = useInAndroidAppShell()
  const isSmallScreen = useIsSmallScreen()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isSmallScreen && !inAndroidAppShell) {
      navigate({ to: '/settings/provider/$providerId', params: { providerId: 'openai' }, replace: true })
    }
  }, [isSmallScreen, inAndroidAppShell, navigate])

  return null
}
