import { Alert, Anchor, Box, Button, Center, Divider, Flex, Loader, Progress, Stack, Text, UnstyledButton } from '@mantine/core'
import { TASK_DEFAULT_DIRECTORY } from '@shared/constants/task'
import { IconAlertTriangle, IconBrandNodejs, IconFolder, IconFolderOpen, IconRocket, IconTerminal2 } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Page from '@/components/layout/Page'
import { getAgentWorkingDirectory } from '@/mobile/agent-broker'
import platform from '@/platform'
import { type NativeSandboxProgress, yachiyoSandboxNative } from '@/platform/native/yachiyo_sandbox'
import { recentDirectoriesStore, useRecentDirectories } from '@/stores/recentDirectoriesStore'
import { createTaskSession, taskSessionStore } from '@/stores/taskSessionStore'

export const Route = createFileRoute('/task/')({
  component: TaskPage,
})

type PageState = 'checking' | 'unavailable' | 'setup' | 'select-directory'

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
          if (platform.type === 'mobile') {
            const status = await yachiyoSandboxNative.status()
            setPageState(status.toolchainReady ? 'select-directory' : 'setup')
          } else {
            setPageState('select-directory')
          }
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
      {pageState === 'setup' && <SandboxSetup onReady={() => setPageState('select-directory')} />}
      {pageState === 'select-directory' && <DirectorySelector />}
    </Page>
  )
}

function SandboxSetup({ onReady }: { onReady: () => void }) {
  const [progress, setProgress] = useState<NativeSandboxProgress | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let handle: { remove: () => Promise<void> } | undefined
    void yachiyoSandboxNative.addListener('progress', setProgress).then((value) => {
      handle = value
    })
    return () => {
      void handle?.remove()
    }
  }, [])

  const startInstall = async () => {
    setInstalling(true)
    setError(null)
    try {
      await yachiyoSandboxNative.install()
      onReady()
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError))
    } finally {
      setInstalling(false)
    }
  }

  const stageLabel: Record<string, string> = {
    downloading: '正在下载 Alpine Linux',
    extracting: '正在安装 Linux 文件系统',
    rootfs_ready: 'Linux 基础环境已就绪',
    installing_toolchain: '正在安装 Python、Node.js 和 Git',
    ready: '开发环境已就绪',
  }

  return (
    <Center h="100%">
      <Stack align="center" gap="lg" maw={440} px="md" w="100%">
        <Box
          className="rounded-full flex items-center justify-center"
          w={72}
          h={72}
          style={{ backgroundColor: 'var(--mantine-color-pink-light)' }}
        >
          <IconTerminal2 size={36} className="text-[var(--mantine-color-pink-filled)]" />
        </Box>
        <Stack align="center" gap="xs">
          <Text fw={700} size="xl" ta="center">
            初始化本地开发环境
          </Text>
          <Text c="dimmed" size="sm" ta="center" maw={360}>
            首次使用会安装 Alpine Linux、Python、Node.js、Git 和本地编译工具。环境位于应用私有目录。
          </Text>
        </Stack>
        {progress && (
          <Stack gap="xs" w="100%">
            <Flex justify="space-between" align="center">
              <Text size="sm" fw={600}>
                {stageLabel[progress.stage] || progress.stage}
              </Text>
              {progress.total > 0 && (
                <Text size="xs" c="dimmed">
                  {progress.percent}%
                </Text>
              )}
            </Flex>
            <Progress
              value={progress.total > 0 ? progress.percent : 100}
              animated={progress.total <= 0}
              color="pink"
              radius="xl"
            />
          </Stack>
        )}
        {error && (
          <Alert color="red" radius="md" w="100%">
            {error}
          </Alert>
        )}
        <Button
          size="lg"
          radius="xl"
          color="pink"
          leftSection={<IconBrandNodejs size={20} />}
          loading={installing}
          onClick={() => void startInstall()}
        >
          安装开发环境
        </Button>
      </Stack>
    </Center>
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
