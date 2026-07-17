import { Alert, Anchor, Box, Button, Center, Divider, Flex, Loader, Stack, Text, UnstyledButton } from '@mantine/core'
import { TASK_DEFAULT_DIRECTORY } from '@shared/constants/task'
import { IconAlertTriangle, IconFolder, IconFolderOpen, IconRocket } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Page from '@/components/layout/Page'
import { getAgentWorkingDirectory } from '@/mobile/agent-broker'
import platform from '@/platform'
import { recentDirectoriesStore, useRecentDirectories } from '@/stores/recentDirectoriesStore'
import { createTaskSession, taskSessionStore } from '@/stores/taskSessionStore'

export const Route = createFileRoute('/task/')({
  component: TaskPage,
})

type PageState = 'checking' | 'unavailable' | 'select-directory'

function TaskPage() {
  const { t } = useTranslation()

  const [pageState, setPageState] = useState<PageState>('checking')
  const [unavailableReason, setUnavailableReason] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    const checkAvailability = async () => {
      if (!platform.sandboxCheckAvailability) {
        if (!cancelled) setPageState('select-directory')
        return
      }
      try {
        const result = await platform.sandboxCheckAvailability()
        if (cancelled) return
        if (result.available) {
          setPageState('select-directory')
        } else {
          setUnavailableReason(result.reason || '')
          setPageState('unavailable')
        }
      } catch {
        if (!cancelled) setPageState('select-directory')
      }
    }
    void checkAvailability()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Page title={t('Task')}>
      {pageState === 'checking' && <CheckingState />}
      {pageState === 'unavailable' && <UnavailableState reason={unavailableReason} />}
      {pageState === 'select-directory' && <DirectorySelector />}
    </Page>
  )
}

function CheckingState() {
  const { t } = useTranslation()
  return (
    <Center h="100%">
      <Stack align="center" gap="md">
        <Loader size="lg" />
        <Text c="dimmed" size="sm">
          {t('Checking availability...')}
        </Text>
      </Stack>
    </Center>
  )
}

function UnavailableState({ reason }: { reason: string }) {
  const { t } = useTranslation()
  const isWsl2Required = reason === 'wsl2_required'
  return (
    <Center h="100%">
      <Stack align="center" gap="lg" maw={480} px="md">
        <Box
          className="rounded-full flex items-center justify-center"
          w={64}
          h={64}
          style={{ backgroundColor: 'var(--mantine-color-orange-light)' }}
        >
          <IconAlertTriangle size={32} className="text-[var(--mantine-color-orange-filled)]" />
        </Box>
        <Stack align="center" gap="xs">
          <Text fw={700} size="xl" ta="center">
            {t('Sandbox Not Available')}
          </Text>
          <Text c="dimmed" size="sm" ta="center">
            {isWsl2Required
              ? t('This feature requires WSL2 on Windows. Please install WSL2 to use sandbox features.')
              : t('This feature is not available on your system. Please check the system requirements.')}
          </Text>
        </Stack>
        {isWsl2Required && (
          <Stack gap="xs" w="100%">
            <Alert
              variant="light"
              color="blue"
              radius="md"
              title={t('How to install WSL2')}
              icon={<IconRocket size={20} />}
            >
              <Stack gap={4}>
                <Text size="sm">{t('1. Open PowerShell or Command Prompt as Administrator')}</Text>
                <Text size="sm">{t('2. Run command: wsl --install')}</Text>
                <Text size="sm">{t('3. Restart your computer when prompted')}</Text>
              </Stack>
            </Alert>
            <Center>
              <Anchor
                href="https://learn.microsoft.com/en-us/windows/wsl/install"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="light" radius="md">
                  {t('Learn more about WSL2')}
                </Button>
              </Anchor>
            </Center>
          </Stack>
        )}
      </Stack>
    </Center>
  )
}

function DirectorySelector() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const recentDirs = useRecentDirectories()
  const [loadingButton, setLoadingButton] = useState<'quick-start' | 'choose-dir' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = loadingButton !== null
  const isAndroidAgent = platform.type === 'mobile'

  const startSession = useCallback(
    async (path: string, button: 'quick-start' | 'choose-dir' = 'quick-start') => {
      setLoadingButton(button)
      setError(null)
      try {
        if (path !== TASK_DEFAULT_DIRECTORY) recentDirectoriesStore.getState().addDirectory(path)
        const session = await createTaskSession({
          name: 'New Task',
          workingDirectory: path,
          messages: [],
        })
        taskSessionStore.getState().setCurrentTaskId(session.id)
        navigate({ to: '/task/$taskId', params: { taskId: session.id } })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoadingButton(null)
      }
    },
    [navigate]
  )

  const handleChooseDirectory = useCallback(async () => {
    if (!platform.openDirectoryDialog) {
      setError(t('Directory selection is not available on this platform.'))
      return
    }
    const result = await platform.openDirectoryDialog()
    if (result.canceled || !result.path) return
    await startSession(result.path, 'choose-dir')
  }, [t, startSession])

  return (
    <Center h="100%">
      <Stack align="center" gap="lg" maw={480} px="md">
        <Box
          className="rounded-full flex items-center justify-center"
          w={72}
          h={72}
          style={{ backgroundColor: 'var(--mantine-color-blue-light)' }}
        >
          <IconFolder size={36} className="text-[var(--mantine-color-blue-filled)]" />
        </Box>
        <Stack align="center" gap="xs">
          <Text fw={700} size="xl" ta="center">
            {t('Select Working Directory')}
          </Text>
          <Text c="dimmed" size="sm" ta="center" maw={360}>
            {t(
              'Choose a local directory for the AI to work in. Files in this directory will be accessible to the sandbox.'
            )}
          </Text>
        </Stack>
        {error && (
          <Alert color="red" radius="md" w="100%">
            {error}
          </Alert>
        )}
        <Button
          size="lg"
          radius="md"
          variant="filled"
          leftSection={<IconRocket size={20} />}
          onClick={() =>
            startSession(isAndroidAgent ? getAgentWorkingDirectory() : TASK_DEFAULT_DIRECTORY, 'quick-start')
          }
          loading={loadingButton === 'quick-start'}
          disabled={loading && loadingButton !== 'quick-start'}
        >
          {t('Quick Start')}
        </Button>
        {!isAndroidAgent && recentDirs.length > 0 && (
          <Divider label={t('or choose a directory')} labelPosition="center" w="100%" />
        )}
        {!isAndroidAgent && recentDirs.length > 0 && (
          <Stack gap="xs" w="100%">
            <Text size="sm" c="dimmed" fw={500}>
              {t('Recent')}
            </Text>
            {recentDirs.map((dir) => (
              <UnstyledButton
                key={dir}
                className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-[var(--chatbox-background-secondary)] transition-colors w-full"
                onClick={() => startSession(dir)}
                disabled={loading}
              >
                <IconFolder size={20} className="text-[var(--chatbox-tint-secondary)] shrink-0" />
                <Flex direction="column" gap={0} className="min-w-0 flex-1">
                  <Text size="sm" fw={500} truncate>
                    {dir.split('/').filter(Boolean).pop() || dir}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {dir}
                  </Text>
                </Flex>
              </UnstyledButton>
            ))}
          </Stack>
        )}
        <Button
          size="lg"
          radius="md"
          variant="light"
          leftSection={<IconFolderOpen size={20} />}
          onClick={handleChooseDirectory}
          loading={loadingButton === 'choose-dir'}
          disabled={loading && loadingButton !== 'choose-dir'}
        >
          {t('Choose a directory')}
        </Button>
      </Stack>
    </Center>
  )
}
