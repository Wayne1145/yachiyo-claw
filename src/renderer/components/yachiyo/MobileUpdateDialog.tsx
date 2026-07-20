import { Button, Group, Modal, Progress, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import platform from '@/platform'
import {
  checkForUpdates,
  downloadUpdate,
  openUpdateInstallPermissionSettings,
  requestInstallUpdate,
  useUpdateStore,
} from '@/stores/updateStore'

export function MobileUpdateDialog() {
  const { t } = useTranslation()
  const status = useUpdateStore((state) => state.status)
  const progress = useUpdateStore((state) => state.progress)
  const version = useUpdateStore((state) => state.version)
  const error = useUpdateStore((state) => state.error)
  const dismissedVersion = useUpdateStore((state) => state.dismissedVersion)
  const dismiss = useUpdateStore((state) => state.dismiss)
  const visibleStatus = ['available', 'downloading', 'downloaded', 'permission-required', 'error'].includes(status)
  const opened = platform.type === 'mobile' && Boolean(version) && dismissedVersion !== version && visibleStatus

  return (
    <Modal
      opened={opened}
      onClose={dismiss}
      title={version ? `${t('New version available')} v${version}` : t('New version available')}
      centered
      size="sm"
    >
      <Stack gap="md">
        <Text c="chatbox-secondary">
          {status === 'permission-required'
            ? 'Android must allow Yachiyo Claw to install unknown apps. Return here after granting access.'
            : 'The APK stays in private app cache and is passed to Android only after SHA-256 verification.'}
        </Text>

        {status === 'downloading' && (
          <Stack gap="xs">
            <Progress value={progress} animated radius="xl" />
            <Text size="xs" ta="center" c="chatbox-tertiary">
              {t('Downloading...')} {progress}%
            </Text>
          </Stack>
        )}

        {status === 'error' && (
          <Text size="xs" c="chatbox-error">
            {error || t('Update failed')}
          </Text>
        )}

        <Group justify="flex-end" wrap="wrap">
          <Button variant="default" onClick={dismiss} disabled={status === 'downloading'}>
            {t('Later')}
          </Button>
          {status === 'available' && <Button onClick={() => void downloadUpdate()}>{t('Download Update')}</Button>}
          {status === 'downloaded' && <Button onClick={() => void requestInstallUpdate()}>{t('Install Update')}</Button>}
          {status === 'permission-required' && (
            <Button onClick={() => void openUpdateInstallPermissionSettings()}>{t('Open Settings')}</Button>
          )}
          {status === 'error' && <Button onClick={() => void checkForUpdates()}>{t('Retry')}</Button>}
        </Group>
      </Stack>
    </Modal>
  )
}
