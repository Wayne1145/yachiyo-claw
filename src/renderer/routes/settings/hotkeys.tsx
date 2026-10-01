import { SettingsPage, SettingsSection } from '@/components/settings/SettingsPage'
import { useTranslation } from 'react-i18next'
import { createFileRoute } from '@tanstack/react-router'
import { ShortcutConfig } from '@/components/Shortcut'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/hotkeys')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const shortcuts = useSettingsStore((state) => state.shortcuts)
  const setSettings = useSettingsStore((state) => state.setSettings)
  return (
    <SettingsPage title={t('Keyboard Shortcuts')}>
      <SettingsSection>
        <ShortcutConfig shortcuts={shortcuts} setShortcuts={(shortcuts) => setSettings({ shortcuts })} />
      </SettingsSection>
    </SettingsPage>
  )
}
