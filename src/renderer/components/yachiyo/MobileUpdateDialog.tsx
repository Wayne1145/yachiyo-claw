import { Button, Group, Modal, Progress, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { AndroidAppShellContext } from '@/components/yachiyo/AndroidAppShellContext'
import { shouldUseAndroidAppShell } from '@/mobile/android-app-shell'
import platform from '@/platform'
import {
  checkForUpdates,
  downloadUpdate,
  openUpdateInstallPermissionSettings,
  requestInstallUpdate,
  useUpdateStore,
} from '@/stores/updateStore'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'

export function MobileUpdateDialog() {
  const { t } = useTranslation()
  const status = useUpdateStore((state) => state.status)
  const progress = useUpdateStore((state) => state.progress)
  const version = useUpdateStore((state) => state.version)
  const error = useUpdateStore((state) => state.error)
  const notes = useUpdateStore((state) => state.notes)
  const dismissedVersion = useUpdateStore((state) => state.dismissedVersion)
  const dismiss = useUpdateStore((state) => state.dismiss)
  const visibleStatus = ['available', 'downloading', 'downloaded', 'permission-required', 'error'].includes(status)
  const opened = platform.type === 'mobile' && Boolean(version) && dismissedVersion !== version && visibleStatus
  const inAndroidAppShell = shouldUseAndroidAppShell(platform.type, CHATBOX_BUILD_PLATFORM)
  const title = version ? t('发现新版本 v{{version}}', { version }) : t('发现新版本')
  const actionButtons = (
    <>
      <Button variant="default" onClick={dismiss}>
        {t('稍后')}
      </Button>
      {status === 'available' && <Button onClick={() => void downloadUpdate()}>{t('下载更新')}</Button>}
      {status === 'downloaded' && <Button onClick={() => void requestInstallUpdate()}>{t('安装更新')}</Button>}
      {status === 'permission-required' && (
        <Button onClick={() => void openUpdateInstallPermissionSettings()}>{t('前往授权')}</Button>
      )}
      {status === 'error' && <Button onClick={() => void checkForUpdates()}>{t('重试')}</Button>}
    </>
  )

  const content = (
    <Stack gap="md">
      <Text c="chatbox-secondary">
        {status === 'permission-required'
          ? t('请允许 Yachiyo Claw 安装未知来源应用，授权后返回此处继续安装。')
          : t('更新包会在校验 SHA-256 通过后才交给 Android 安装。')}
      </Text>
      {notes && (
        <Stack gap={4}>
          <Text fw={600} size="sm">
            {t('更新日志')}
          </Text>
          <div
            className="mobile-update-notes"
            style={{ maxHeight: 280, overflowY: 'auto', fontSize: 13, lineHeight: 1.55, wordBreak: 'break-word' }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Release notes open external links in the system browser, never inside the app webview.
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(event) => {
                      event.preventDefault()
                      if (href) void platform.openLink(href)
                    }}
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {notes}
            </ReactMarkdown>
          </div>
        </Stack>
      )}

      {status === 'downloading' && (
        <Stack gap="xs">
          <Progress value={progress} animated radius="xl" />
          <Text size="xs" ta="center" c="chatbox-tertiary">
            {t('正在下载 {{progress}}%', { progress })}
          </Text>
        </Stack>
      )}

      {status === 'error' && (
        <Text size="xs" c="chatbox-error">
          {error || t('Update failed')}
        </Text>
      )}

      {inAndroidAppShell ? (
        <AdaptiveModal.Actions>{actionButtons}</AdaptiveModal.Actions>
      ) : (
        <Group justify="flex-end" wrap="wrap">
          {actionButtons}
        </Group>
      )}
    </Stack>
  )

  if (inAndroidAppShell) {
    return (
      <AndroidAppShellContext.Provider value>
        <AdaptiveModal opened={opened} onClose={dismiss} title={title} centered size="md">
          {content}
        </AdaptiveModal>
      </AndroidAppShellContext.Provider>
    )
  }

  return (
    <Modal opened={opened} onClose={dismiss} title={title} centered size="md">
      {content}
    </Modal>
  )
}
