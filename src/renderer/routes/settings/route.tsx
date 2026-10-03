import { ActionIcon } from '@mantine/core'
import { IconChevronLeft } from '@tabler/icons-react'
import { createFileRoute, Outlet, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'
import Page from '@/components/layout/Page'
import { SettingsNavigation } from '@/components/settings/SettingsNavigation'
import { useInAndroidAppShell } from '@/components/yachiyo/AndroidAppShellContext'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import '@/components/settings/settings.css'

export const Route = createFileRoute('/settings')({ component: RouteComponent })

export function RouteComponent() {
  const { t } = useTranslation()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <Page
      title={t('Settings')}
      left={
        <ActionIcon
          className="controls"
          variant="subtle"
          size={44}
          radius="xl"
          aria-label={String(t('Back'))}
          onClick={() =>
            pathname !== '/settings'
              ? void router.navigate({ to: '/settings' })
              : canGoBack
                ? router.history.back()
                : void router.navigate({ to: '/' })
          }
        >
          <IconChevronLeft size={22} />
        </ActionIcon>
      }
    >
      <SettingsRoot />
      <Toaster richColors position="bottom-center" style={{ zIndex: 2147483647 }} />
    </Page>
  )
}

export function SettingsRoot() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const isSmallScreen = useIsSmallScreen()
  const inAndroidAppShell = useInAndroidAppShell()
  const isHome = pathname.replace(/\/$/, '') === '/settings'
  if (inAndroidAppShell)
    return (
      <div className="settings-surface">
        <Outlet />
      </div>
    )
  return (
    <div className="settings-layout settings-surface">
      {!isSmallScreen && !isHome && (
        <aside className="settings-sidebar">
          <SettingsNavigation compact />
        </aside>
      )}
      <div className="settings-content">
        <Outlet />
      </div>
    </div>
  )
}
