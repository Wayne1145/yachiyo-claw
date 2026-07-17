import { ActionIcon, Button, Flex, Paper, Stack, Text } from '@mantine/core'
import { IconDeviceDesktop, IconDownload, IconX } from '@tabler/icons-react'
import { useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { buildChatboxUrl } from '@/packages/remote'
import platform from '@/platform'
import { useLanguage, useSettingsStore } from '@/stores/settingsStore'

export default function DesktopDownloadReminder() {
  const { t } = useTranslation()
  const location = useLocation()
  const language = useLanguage()
  const setSettings = useSettingsStore((state) => state.setSettings)
  const dismissed = useSettingsStore((state) => state.chatboxAIDesktopPromptDismissed)

  if (platform.type !== 'web' || dismissed) {
    return null
  }

  if (location.pathname.startsWith('/settings') || Boolean((location.search as Record<string, unknown>)?.settings)) {
    return null
  }

  return (
    <div className="fixed right-4 bottom-4 z-[120] w-[min(360px,calc(100vw-2rem))]">
      <Paper withBorder radius="lg" p="md" shadow="lg" className="backdrop-blur-sm bg-chatbox-background-primary/95">
        <Stack gap="sm">
          <Flex justify="space-between" gap="sm" align="flex-start">
            <Flex gap="sm" align="flex-start" flex={1}>
              <ScalableIcon icon={IconDeviceDesktop} size={20} className="text-chatbox-brand mt-2 shrink-0" />
                <Text fw={600}>{t('More advanced features are available in Chatbox Desktop.')}
                </Text>
            </Flex>

            <ActionIcon
              variant="subtle"
              color="chatbox-secondary"
              onClick={() => setSettings({ chatboxAIDesktopPromptDismissed: true })}
              aria-label={t('Close') || 'Close'}
            >
              <ScalableIcon icon={IconX} size={16} />
            </ActionIcon>
          </Flex>

          <Text size="xs" c="chatbox-secondary" style={{ whiteSpace: 'pre-line' }}>
            {t(
              '1. Your chat history on web version can only be stored in the browser cache (unreliable - it may be cleaned by browser). \n2. MCP and Knowledge Base are currently supported on the desktop app only. '
            )}
          </Text>

          <Button
            size="compact-sm"
            leftSection={<ScalableIcon icon={IconDownload} size={14} />}
            className="mx-2"
            onClick={() =>
              platform.openLink(
                buildChatboxUrl(`/redirect_app/homepage/${language}?utm_source=web&utm_content=floating_desktop_prompt#download`)
              )
            }
          >
            {t('Download Desktop App')}
          </Button>
        </Stack>
      </Paper>
    </div>
  )
}
