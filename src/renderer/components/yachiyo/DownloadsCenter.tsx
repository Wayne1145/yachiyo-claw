import {
  ActionIcon,
  Badge,
  Button,
  Group,
  NumberInput,
  Progress,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import {
  IconArrowLeft,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { router } from '@/router'
import { yachiyoModelManagerNative } from '@/platform/native/yachiyo_model_manager'
import { type NativeDownloadTask, yachiyoDownloadsNative } from '@/platform/native/yachiyo_downloads'
import { yachiyoSandboxNative } from '@/platform/native/yachiyo_sandbox'
import { yachiyoUpdateNative } from '@/platform/native/yachiyo_update'
import { useInAndroidAppShell } from './AndroidAppShellContext'
import { downloadProgress, humanizeDownloadError, requireAcceptedDownloadAction } from './download-ui'

function bytes(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** power).toFixed(power > 1 ? 1 : 0)} ${units[power]}`
}

function etaLabel(remaining: number, bytesPerSecond: number) {
  if (bytesPerSecond <= 0 || remaining <= 0) return ''
  const seconds = Math.round(remaining / bytesPerSecond)
  if (seconds < 60) return `剩余约 ${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `剩余约 ${minutes} 分 ${seconds % 60} 秒`
  const hours = Math.floor(minutes / 60)
  return `剩余约 ${hours} 小时 ${minutes % 60} 分`
}

const labels: Record<NativeDownloadTask['status'], string> = {
  queued: '等待下载',
  downloading: '正在下载',
  paused: '已暂停',
  completed: '已完成',
  failed: '下载失败',
  cancelled: '已取消',
}
const kindLabels: Record<string, string> = {
  update: '软件更新',
  sandbox: 'Linux 沙箱',
  model: '本地模型',
  plugin: '插件包',
  skill: 'Skill 包',
  theme: '主题包',
  resource: '应用资源',
}
const isTerminal = (status: string) => status === 'completed' || status === 'failed' || status === 'cancelled'

export function DownloadsCenter() {
  const inAndroidAppShell = useInAndroidAppShell()
  const [nativeTasks, setNativeTasks] = useState<NativeDownloadTask[]>([])
  const [loading, setLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [proxy, setProxy] = useState('')
  const [threads, setThreads] = useState(8)
  const [wifiOnly, setWifiOnly] = useState(false)
  const [retryCount, setRetryCount] = useState(3)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (clearExistingError = false) => {
    setLoading(true)
    try {
      const downloads = await yachiyoDownloadsNative.list()
      setNativeTasks(Array.isArray(downloads.tasks) ? downloads.tasks : [])
      if (clearExistingError) setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载任务读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(true)
    const id = window.setInterval(() => void refresh(), 1200)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    void yachiyoDownloadsNative
      .getSettings()
      .then((value) => {
        setProxy(value.proxy)
        setThreads(value.threads)
        setWifiOnly(value.wifiOnly)
        setRetryCount(value.retryCount)
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '下载设置读取失败'))
  }, [])

  const controlModel = async (task: NativeDownloadTask, type: 'pause' | 'resume' | 'cancel') => {
    try {
      const result = await yachiyoModelManagerNative[type]({ jobId: task.id })
      requireAcceptedDownloadAction(result)
      await refresh(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '本地模型下载操作失败')
    }
  }

  const controlUpdate = async (task: NativeDownloadTask, type: 'pause' | 'resume' | 'cancel') => {
    const version = task.id.replace(/^update-/, '')
    try {
      const result =
        type === 'pause'
          ? await yachiyoUpdateNative.pauseDownload({ version })
          : type === 'cancel'
            ? await yachiyoUpdateNative.cancelDownload({ version })
            : await yachiyoUpdateNative.resumeDownload({ version })
      requireAcceptedDownloadAction(result)
      await refresh(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新下载操作失败')
    }
  }

  const controlSandbox = async (type: 'pause' | 'resume' | 'cancel') => {
    try {
      const result =
        type === 'pause'
          ? await yachiyoSandboxNative.pauseDownload()
          : type === 'cancel'
            ? await yachiyoSandboxNative.cancelDownload()
            : await yachiyoSandboxNative.resumeDownload()
      requireAcceptedDownloadAction(result)
      await refresh(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Linux 环境下载操作失败')
    }
  }

  const controlGeneric = async (task: NativeDownloadTask, type: 'pause' | 'resume' | 'cancel') => {
    try {
      const result = await yachiyoDownloadsNative[type]({ id: task.id })
      requireAcceptedDownloadAction(result)
      await refresh(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载操作失败')
    }
  }

  const removeTask = async (task: NativeDownloadTask) => {
    try {
      if (!['update', 'sandbox', 'model'].includes(task.kind)) {
        await yachiyoDownloadsNative.removeArtifact({ id: task.id })
        await refresh(true)
        return
      }
      const result = await yachiyoDownloadsNative.remove({ id: task.id })
      setNativeTasks(result.tasks)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载记录移除失败')
    }
  }

  const saveSettings = async () => {
    try {
      const value = await yachiyoDownloadsNative.saveSettings({ proxy, threads, wifiOnly, retryCount })
      setProxy(value.proxy)
      setThreads(value.threads)
      setWifiOnly(value.wifiOnly)
      setRetryCount(value.retryCount)
      setSettingsOpen(false)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载设置保存失败')
    }
  }

  return (
    <main className="local-model-center local-model-download-queue">
      <header className="local-model-queue-heading">
        <Group gap="sm">
          {!inAndroidAppShell && (
            <ActionIcon
              variant="subtle"
              aria-label="返回设置"
              onClick={() => void router.navigate({ to: '/settings' })}
            >
              <IconArrowLeft />
            </ActionIcon>
          )}
          <div>
            <Title order={2}>下载管理</Title>
            <Text size="sm" c="dimmed">
              下载任务会在应用重启后继续调度
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          <ActionIcon variant="default" aria-label="下载器设置" onClick={() => setSettingsOpen((value) => !value)}>
            <IconSettings />
          </ActionIcon>
          <ActionIcon variant="default" aria-label="刷新下载列表" loading={loading} onClick={() => void refresh(true)}>
            <IconRefresh />
          </ActionIcon>
        </Group>
      </header>

      {error && (
        <section className="local-model-queue-row" role="alert">
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" c="red" style={{ overflowWrap: 'anywhere' }}>
              {error}
            </Text>
            <Button size="compact-sm" variant="default" onClick={() => void refresh(true)}>
              重试
            </Button>
          </Group>
        </section>
      )}

      {settingsOpen && (
        <section className="local-model-queue-row">
          <Stack gap="xs">
            <Text fw={650}>下载器设置</Text>
            <TextInput
              value={proxy}
              onChange={(event) => setProxy(event.currentTarget.value)}
              label="HTTP 代理服务器"
              placeholder="http://127.0.0.1:7890"
            />
            <NumberInput
              value={threads}
              onChange={(value) => setThreads(typeof value === 'number' ? value : 8)}
              min={1}
              max={64}
              label="并发线程数"
              description="默认 8，最高 64；服务端不支持分段下载时会自动回退。"
            />
            <NumberInput
              value={retryCount}
              onChange={(value) => setRetryCount(typeof value === 'number' ? value : 3)}
              min={0}
              max={16}
              label="失败重试次数"
              description="下载失败后自动重试的次数，默认 3 次。"
            />
            <Switch
              checked={wifiOnly}
              onChange={(event) => setWifiOnly(event.currentTarget.checked)}
              label="仅在 Wi-Fi 下下载"
            />
            <Button onClick={() => void saveSettings()}>保存下载设置</Button>
          </Stack>
        </section>
      )}

      <Stack gap="sm">
        {nativeTasks.length === 0 && (
          <Text c="dimmed" ta="center" py="xl">
            暂无下载任务
          </Text>
        )}

        {nativeTasks.map((task) => {
          const progress = downloadProgress(task.bytesDownloaded, task.bytesTotal)
          const eta =
            task.status === 'downloading' ? etaLabel(task.bytesTotal - task.bytesDownloaded, task.bytesPerSecond) : ''
          const canControl = true
          const control = (type: 'pause' | 'resume' | 'cancel') =>
            task.kind === 'sandbox'
              ? controlSandbox(type)
              : task.kind === 'update'
                ? controlUpdate(task, type)
                : task.kind === 'model'
                  ? controlModel(task, type)
                  : controlGeneric(task, type)
          return (
            <section key={task.id} className="local-model-queue-row">
              <Group justify="space-between">
                <div>
                  <Text fw={650}>{task.title}</Text>
                  <Text size="xs" c="dimmed">
                    {kindLabels[task.kind] || '应用下载'}
                  </Text>
                </div>
                <Badge
                  color={task.status === 'failed' ? 'red' : task.status === 'downloading' ? 'chatbox-brand' : 'gray'}
                >
                  {labels[task.status]}
                </Badge>
              </Group>
              <Progress value={progress} animated={task.status === 'downloading'} color="chatbox-brand" radius="xl" />
              <Group justify="space-between">
                <Text size="xs">
                  {bytes(task.bytesDownloaded)} / {bytes(task.bytesTotal)}
                  {task.bytesPerSecond > 0 ? ` · ${bytes(task.bytesPerSecond)}/s` : ''}
                  {eta ? ` · ${eta}` : ''}
                </Text>
                <Text size="xs">{progress.toFixed(1)}%</Text>
              </Group>
              {task.error && (
                <Text size="xs" c="red">
                  {humanizeDownloadError(task.error)}
                </Text>
              )}
              <Group justify="flex-end">
                {canControl && (task.status === 'downloading' || task.status === 'queued') && (
                  <Button
                    size="compact-sm"
                    variant="default"
                    leftSection={<IconPlayerPause size={15} />}
                    onClick={() => void control('pause')}
                  >
                    暂停
                  </Button>
                )}
                {canControl && (task.status === 'paused' || task.status === 'failed') && (
                  <Button
                    size="compact-sm"
                    variant="default"
                    leftSection={<IconPlayerPlay size={15} />}
                    onClick={() => void control('resume')}
                  >
                    继续
                  </Button>
                )}
                {canControl && !isTerminal(task.status) && (
                  <ActionIcon color="red" variant="subtle" aria-label="取消下载" onClick={() => void control('cancel')}>
                    <IconX size={17} />
                  </ActionIcon>
                )}
                {isTerminal(task.status) && (
                  <ActionIcon variant="subtle" aria-label="移除记录" onClick={() => void removeTask(task)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </Group>
            </section>
          )
        })}
      </Stack>
    </main>
  )
}
