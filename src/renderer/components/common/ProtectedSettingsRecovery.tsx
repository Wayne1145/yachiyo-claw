import { Alert, Box, Button, MantineProvider, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { IconAlertTriangle, IconLockExclamation, IconRefresh, IconTrash, IconX } from '@tabler/icons-react'
import { useMemo, useState } from 'react'

interface ProtectedSettingsRecoveryProps {
  onReset: () => Promise<void>
}

const copy = {
  en: {
    title: 'Protected settings could not be opened',
    description:
      'The device security key may have changed. Yachiyo Claw kept the settings locked instead of opening damaged data.',
    impact: 'Resetting removes API keys and app settings. Chats and other local data stay on this device.',
    reset: 'Reset settings',
    confirm: 'Delete settings and restart',
    cancel: 'Cancel',
    failure: 'Settings could not be reset. Restart the app and try again.',
  },
  zh: {
    title: '无法打开受保护的设置',
    description: '设备安全密钥可能已更改。Yachiyo Claw 已保持设置锁定，不会尝试打开损坏的数据。',
    impact: '重置会删除 API 密钥和应用设置。聊天记录及其他本地数据会保留在此设备上。',
    reset: '重置设置',
    confirm: '删除设置并重新启动',
    cancel: '取消',
    failure: '无法重置设置。请重新启动应用后再试。',
  },
} as const

export function ProtectedSettingsRecovery({ onReset }: ProtectedSettingsRecoveryProps) {
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [failed, setFailed] = useState(false)
  const labels = useMemo(() => copy[navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'], [])

  const handleReset = async () => {
    setResetting(true)
    setFailed(false)
    try {
      await onReset()
    } catch {
      setFailed(true)
      setResetting(false)
    }
  }

  return (
    <MantineProvider defaultColorScheme="auto">
      <Box
        component="main"
        mih="100dvh"
        px="md"
        style={{
          alignItems: 'center',
          backgroundColor: 'var(--mantine-color-body)',
          display: 'flex',
          justifyContent: 'center',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
          paddingTop: 'max(24px, env(safe-area-inset-top))',
        }}
      >
        <Paper withBorder radius="md" shadow="sm" p={{ base: 'lg', sm: 'xl' }} w="100%" maw={440}>
          <Stack gap="lg">
            <ThemeIcon color="teal" variant="light" size={48} radius="md">
              <IconLockExclamation size={26} stroke={1.8} />
            </ThemeIcon>

            <Stack gap={8}>
              <Title order={1} size="h3" style={{ overflowWrap: 'anywhere' }}>
                {labels.title}
              </Title>
              <Text c="dimmed" size="sm" lh={1.6}>
                {labels.description}
              </Text>
            </Stack>

            {!confirming ? (
              <Button leftSection={<IconRefresh size={18} />} onClick={() => setConfirming(true)} fullWidth>
                {labels.reset}
              </Button>
            ) : (
              <Stack gap="md">
                <Alert color="red" variant="light" icon={<IconAlertTriangle size={20} />}>
                  {labels.impact}
                </Alert>
                <Stack gap="xs">
                  <Button
                    color="red"
                    leftSection={<IconTrash size={18} />}
                    loading={resetting}
                    onClick={handleReset}
                    fullWidth
                    styles={{
                      label: { lineHeight: 1.35, whiteSpace: 'normal' },
                      root: { height: 'auto', minHeight: 40 },
                    }}
                  >
                    {labels.confirm}
                  </Button>
                  <Button
                    variant="default"
                    leftSection={<IconX size={18} />}
                    disabled={resetting}
                    fullWidth
                    onClick={() => {
                      setConfirming(false)
                      setFailed(false)
                    }}
                  >
                    {labels.cancel}
                  </Button>
                </Stack>
              </Stack>
            )}

            {failed && (
              <Text c="red" size="sm" role="alert">
                {labels.failure}
              </Text>
            )}
          </Stack>
        </Paper>
      </Box>
    </MantineProvider>
  )
}
