import { ModelProviderEnum } from '@shared/types'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useEffect } from 'react'
import { z } from 'zod'
import { useInAndroidAppShell } from '@/components/yachiyo/AndroidAppShellContext'
import { useIsSmallScreen } from '@/hooks/useScreenChange'

const searchSchema = z.object({
  settings: z.string().optional(), // b64 encoded config
})

export const Route = createFileRoute('/settings/')({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
})

export function RouteComponent() {
  const isSmallScreen = useIsSmallScreen()
  const inAndroidAppShell = useInAndroidAppShell()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isSmallScreen) {
      if (inAndroidAppShell) {
        navigate({
          to: '/settings/provider/$providerId',
          params: { providerId: ModelProviderEnum.Yachiyo },
          replace: true,
        })
      } else {
        navigate({ to: '/settings/chatbox-ai', replace: true })
      }
    }
  }, [inAndroidAppShell, isSmallScreen, navigate])

  return null
}
