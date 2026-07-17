import { Box } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { ShortcutConfig } from '@/components/Shortcut'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/hotkeys')({
  component: RouteComponent,
})

export function RouteComponent() {
  const shortcuts = useSettingsStore((state) => state.shortcuts)
  const setSettings = useSettingsStore((state) => state.setSettings)
  return (
    <Box p="md">
      <ShortcutConfig shortcuts={shortcuts} setShortcuts={(shortcuts) => setSettings({ shortcuts })} />
    </Box>
  )
}
