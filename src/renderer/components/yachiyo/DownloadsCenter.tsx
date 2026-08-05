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
import type { TFunction } from 'i18next'
import type { DownloadJob, ModelArtifact } from '@shared/models/model-catalog'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { router } from '@/router'
import { yachiyoModelManagerNative } from '@/platform/native/yachiyo_model_manager'
import { type NativeDownloadTask, yachiyoDownloadsNative } from '@/platform/native/yachiyo_downloads'
import { yachiyoSandboxNative } from '@/platform/native/yachiyo_sandbox'
import { yachiyoUpdateNative } from '@/platform/native/yachiyo_update'
import { useInAndroidAppShell } from './AndroidAppShellContext'
import { AdaptiveActionCluster, type AdaptiveActionDescriptor } from './AdaptiveActionCluster'
import { downloadProgress, humanizeDownloadError, requireAcceptedDownloadAction } from './download-ui'

function bytes(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** power).toFixed(power > 1 ? 1 : 0)} ${units[power]}`
}

function etaLabel(remaining: number, bytesPerSecond: number, t: TFunction) {
  if (bytesPerSecond <= 0 || remaining <= 0) return ''
  const seconds = Math.round(remaining / bytesPerSecond)
  if (seconds < 60) return t('剩余约 {{seconds}} 秒', { seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('剩余约 {{minutes}} 分 {{seconds}} 秒', { minutes, seconds: seconds % 60 })
  const hours = Math.floor(minutes / 60)
  return t('剩余约 {{hours}} 小时 {{minutes}} 分', { hours, minutes: minutes % 60 })
}

function translatedDownloadError(error: string | undefined, t: TFunction): string {
  const message = humanizeDownloadError(error)
  const http = message.match(/^下载服务器返回错误（HTTP (\d{3})）$/)
  if (http) return t('下载服务器返回错误（HTTP {{status}}）', { status: http[1] })
  const detail = message.match(/^下载失败（(.+)）$/)
  if (detail) return t('下载失败（{{detail}}）', { detail: detail[1] })
  return t(message)
}

const labelKeys: Record<NativeDownloadTask['status'], string> = {
  queued: '等待下载',
  downloading: '正在下载',
  paused: '已暂停',
  completed: '已完成',
  failed: '下载失败',
  cancelled: '已取消',
}
const kindLabelKeys: Record<string, string> = {
  update: '软件更新',
  sandbox: 'Linux 沙箱',
  model: '本地模型',
  plugin: '插件包',
  skill: 'Skill 包',
  theme: '主题包',
  resource: '应用资源',
}
const isTerminal = (status: string) => status === 'completed' || status === 'failed' || status === 'cancelled'
type DownloadedModelArtifact = ModelArtifact & { completedBytes?: number }

export function DownloadsCenter() {
  const { t } = useTranslation()
  const inAndroidAppShell = useInAndroidAppShell()
  const [nativeTasks, setNativeTasks] = useState<NativeDownloadTask[]>([])
  const [modelJobs, setModelJobs] = useState(new Map<string, DownloadJob>())
  const [loading, setLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [proxy, setProxy] = useState('')
  const [threads, setThreads] = useState(8)
  const [wifiOnly, setWifiOnly] = useState(false)
  const [retryCount, setRetryCount] = useState(3)
  const [huggingFaceMirror, setHuggingFaceMirror] = useState(false)
  const [githubMirror, setGithubMirror] = useState(false)
  const [linuxMirror, setLinuxMirror] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(
    async (clearExistingError = false) => {
      setLoading(true)
      try {
        const [downloads, models] = await Promise.all([
          yachiyoDownloadsNative.list(),
          yachiyoModelManagerNative.list().catch(() => ({ schemaVersion: 1 as const, jobs: [] })),
        ])
        setNativeTasks(Array.isArray(downloads.tasks) ? downloads.tasks : [])
        setModelJobs(new Map(models.jobs.map((job) => [job.id, job])))
        if (clearExistingError) setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? translatedDownloadError(cause.message, t) : t('下载任务读取失败'))
      } finally {
        setLoading(false)
      }
    },
    [t]
  )

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
        setHuggingFaceMirror(value.huggingFaceMirror)
        setGithubMirror(value.githubMirror)
        setLinuxMirror(value.linuxMirror)
      })
      .catch((cause) =>
        setError(cause instanceof Error ? translatedDownloadError(cause.message, t) : t('下载设置读取失败'))
      )
  }, [t])

  const controlModel = async (task: NativeDownloadTask, type: 'pause' | 'resume' | 'cancel') => {
    try {
      const result = await yachiyoModelManagerNative[type]({ jobId: task.id })
      requireAcceptedDownloadAction(result)
      await refresh(true)
    } catch (cause) {
      setError(cause instanceof Error ? translatedDownloadError(cause.message, t) : t('本地模型下载操作失败'))
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
      setError(cause instanceof Error ? translatedDownloadError(cause.message, t) : t('更新下载操作失败'))
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
      setError(cause instanceof Error ? translatedDownloadError(cause.message, t) : t('Linux 环境下载操作失败'))
    }
  }

  const controlGeneric = async (task: NativeDownloadTask, type: 'pause' | 'resume' | 'cancel') => {
    try {
      const result = await yachiyoDownloadsNative[type]({ id: task.id })
      requireAcceptedDownloadAction(result)
      await refresh(true)
    } catch (cause) {
      setError(cause instanceof Error ? translatedDownloadError(cause.message, t) : t('下载操作失败'))
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
      setError(cause instanceof Error ? translatedDownloadError(cause.message, t) : t('下载记录移除失败'))
    }
  }

  const saveSettings = async () => {
    try {
      const value = await yachiyoDownloadsNative.saveSettings({
        proxy,
        threads,
        wifiOnly,
        retryCount,
        huggingFaceMirror,
        githubMirror,
        linuxMirror,
      })
      setProxy(value.proxy)
      setThreads(value.threads)
      setWifiOnly(value.wifiOnly)
      setRetryCount(value.retryCount)
      setHuggingFaceMirror(value.huggingFaceMirror)
      setGithubMirror(value.githubMirror)
      setLinuxMirror(value.linuxMirror)
      setSettingsOpen(false)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? translatedDownloadError(cause.message, t) : t('下载设置保存失败'))
    }
  }

  const headerActions: AdaptiveActionDescriptor[] = [
    {
      id: 'settings',
      label: String(t('下载器设置')),
      icon: IconSettings,
      priority: 80,
      collapseStrategy: 'icon',
      renderControl: () => (
        <ActionIcon
          size={44}
          variant="default"
          aria-label={t('下载器设置')}
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <IconSettings />
        </ActionIcon>
      ),
    },
    {
      id: 'refresh',
      label: String(t('刷新下载列表')),
      icon: IconRefresh,
      priority: 100,
      collapseStrategy: 'keep',
      renderControl: () => (
        <ActionIcon
          size={44}
          variant="default"
          aria-label={t('刷新下载列表')}
          loading={loading}
          onClick={() => void refresh(true)}
        >
          <IconRefresh />
        </ActionIcon>
      ),
    },
  ]

  return (
    <main className="local-model-center local-model-download-queue">
      <header className="local-model-queue-heading">
        <Group gap="sm">
          {!inAndroidAppShell && (
            <ActionIcon
              variant="subtle"
              aria-label={t('返回设置')}
              onClick={() => void router.navigate({ to: '/settings' })}
            >
              <IconArrowLeft />
            </ActionIcon>
          )}
          <div>
            <Title order={2}>{t('下载管理')}</Title>
            <Text size="sm" c="dimmed">
              {t('下载任务会在应用重启后继续调度')}
            </Text>
          </div>
        </Group>
        {inAndroidAppShell ? (
          <AdaptiveActionCluster
            className="yachiyo-download-heading-actions"
            ariaLabel={String(t('下载操作'))}
            actions={headerActions}
          />
        ) : (
          <Group gap="xs">
            <ActionIcon
              variant="default"
              aria-label={t('下载器设置')}
              onClick={() => setSettingsOpen((value) => !value)}
            >
              <IconSettings />
            </ActionIcon>
            <ActionIcon
              variant="default"
              aria-label={t('刷新下载列表')}
              loading={loading}
              onClick={() => void refresh(true)}
            >
              <IconRefresh />
            </ActionIcon>
          </Group>
        )}
      </header>

      {error && (
        <section className="local-model-queue-row" role="alert">
          <Group justify="space-between" wrap={inAndroidAppShell ? 'wrap' : 'nowrap'}>
            <Text size="sm" c="red" style={{ overflowWrap: 'anywhere' }}>
              {error}
            </Text>
            <Button size="compact-sm" variant="default" onClick={() => void refresh(true)}>
              {t('重试')}
            </Button>
          </Group>
        </section>
      )}

      {settingsOpen && (
        <section className="local-model-queue-row">
          <Stack gap="xs">
            <Text fw={650}>{t('下载器设置')}</Text>
            <TextInput
              value={proxy}
              onChange={(event) => setProxy(event.currentTarget.value)}
              label={t('HTTP 代理服务器')}
              placeholder="http://127.0.0.1:7890"
            />
            <NumberInput
              value={threads}
              onChange={(value) => setThreads(typeof value === 'number' ? value : 8)}
              min={1}
              max={64}
              label={t('并发线程数')}
              description={t('默认 8，最高 64；服务端不支持分段下载时会自动回退。')}
            />
            <NumberInput
              value={retryCount}
              onChange={(value) => setRetryCount(typeof value === 'number' ? value : 3)}
              min={0}
              max={16}
              label={t('失败重试次数')}
              description={t('下载失败后自动重试的次数，默认 3 次。')}
            />
            <Switch
              checked={wifiOnly}
              onChange={(event) => setWifiOnly(event.currentTarget.checked)}
              label={t('仅在 Wi-Fi 下下载')}
            />
            <Switch
              checked={huggingFaceMirror}
              onChange={(event) => setHuggingFaceMirror(event.currentTarget.checked)}
              label={t('使用 Hugging Face 镜像')}
              description={t('模型搜索和模型文件下载通过 hf-mirror.com 访问。')}
            />
            <Switch
              checked={githubMirror}
              onChange={(event) => setGithubMirror(event.currentTarget.checked)}
              label={t('使用 GitHub 镜像')}
              description={t('软件更新安装包通过 ghfast.top 下载；版本信息仍从 GitHub 获取。')}
            />
            <Switch
              checked={linuxMirror}
              onChange={(event) => setLinuxMirror(event.currentTarget.checked)}
              label={t('使用 Linux 开发环境镜像')}
              description={t('Linux 基础系统、Python、Node.js 和 Android 开发工具优先通过中国大陆镜像下载。')}
            />
            <Button onClick={() => void saveSettings()}>{t('保存下载设置')}</Button>
          </Stack>
        </section>
      )}

      <Stack gap="sm">
        {nativeTasks.length === 0 && (
          <Text c="dimmed" ta="center" py="xl">
            {t('暂无下载任务')}
          </Text>
        )}

        {nativeTasks.map((task) => {
          const progress = downloadProgress(task.bytesDownloaded, task.bytesTotal)
          const eta =
            task.status === 'downloading'
              ? etaLabel(task.bytesTotal - task.bytesDownloaded, task.bytesPerSecond, t)
              : ''
          const canControl = true
          const modelArtifacts = (modelJobs.get(task.id)?.artifacts || []) as DownloadedModelArtifact[]
          const control = (type: 'pause' | 'resume' | 'cancel') =>
            task.kind === 'sandbox'
              ? controlSandbox(type)
              : task.kind === 'update'
                ? controlUpdate(task, type)
                : task.kind === 'model'
                  ? controlModel(task, type)
                  : controlGeneric(task, type)
          const primaryAction =
            task.status === 'downloading' || task.status === 'queued'
              ? {
                  id: 'pause',
                  label: String(t('暂停')),
                  icon: IconPlayerPause,
                  run: () => void control('pause'),
                }
              : task.status === 'paused' || task.status === 'failed'
                ? {
                    id: 'resume',
                    label: String(t('继续')),
                    icon: IconPlayerPlay,
                    run: () => void control('resume'),
                  }
                : undefined
          const secondaryLabel = String(isTerminal(task.status) ? t('移除记录') : t('取消下载'))
          const SecondaryIcon = isTerminal(task.status) ? IconTrash : IconX
          const taskActions: AdaptiveActionDescriptor[] = [
            ...(primaryAction
              ? [
                  {
                    id: primaryAction.id,
                    label: primaryAction.label,
                    icon: primaryAction.icon,
                    priority: 100,
                    collapseStrategy: 'keep' as const,
                    renderControl: () => (
                      <Button
                        variant="default"
                        leftSection={<primaryAction.icon size={16} />}
                        onClick={primaryAction.run}
                      >
                        {primaryAction.label}
                      </Button>
                    ),
                  },
                ]
              : []),
            {
              id: isTerminal(task.status) ? 'remove' : 'cancel',
              label: secondaryLabel,
              icon: SecondaryIcon,
              priority: 10,
              collapseStrategy: 'overflow',
              renderControl: () => (
                <ActionIcon
                  size={44}
                  color={isTerminal(task.status) ? 'gray' : 'red'}
                  variant="subtle"
                  aria-label={secondaryLabel}
                  onClick={() => (isTerminal(task.status) ? void removeTask(task) : void control('cancel'))}
                >
                  <SecondaryIcon size={17} />
                </ActionIcon>
              ),
              menuAction: {
                onSelect: () => (isTerminal(task.status) ? void removeTask(task) : void control('cancel')),
              },
            },
          ]
          return (
            <section key={task.id} className="local-model-queue-row">
              <Group justify="space-between">
                <div>
                  <Text fw={650}>{t(task.title)}</Text>
                  <Text size="xs" c="dimmed">
                    {t(kindLabelKeys[task.kind] || '应用下载')}
                  </Text>
                </div>
                <Badge
                  color={task.status === 'failed' ? 'red' : task.status === 'downloading' ? 'chatbox-brand' : 'gray'}
                >
                  {t(labelKeys[task.status])}
                </Badge>
              </Group>
              {task.kind === 'model' && modelArtifacts.length > 1 && (
                <div className="yachiyo-download-parts" aria-label={String(t('模型分片进度'))}>
                  {modelArtifacts.map((artifact, index) => {
                    const completed = Math.min(artifact.completedBytes || 0, artifact.sizeBytes || 0)
                    const partProgress = downloadProgress(completed, artifact.sizeBytes || 0)
                    return (
                      <div className="yachiyo-download-part" key={artifact.id || artifact.path}>
                        <Group justify="space-between" gap="xs" wrap="nowrap">
                          <Text size="xs" truncate title={artifact.filename || artifact.path}>
                            {t('分片 {{index}}', { index: index + 1 })} · {artifact.filename || artifact.path}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {partProgress.toFixed(0)}%
                          </Text>
                        </Group>
                        <Progress value={partProgress} radius="xl" size="xs" />
                        <Text size="xs" c="dimmed">
                          {bytes(completed)} / {bytes(artifact.sizeBytes || 0)}
                        </Text>
                      </div>
                    )
                  })}
                </div>
              )}
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
                  {translatedDownloadError(task.error, t)}
                </Text>
              )}
              {canControl && inAndroidAppShell ? (
                <AdaptiveActionCluster
                  className="yachiyo-download-task-actions"
                  ariaLabel={`${String(t(task.title))} ${String(t('下载操作'))}`}
                  actions={taskActions}
                />
              ) : (
                <Group justify="flex-end">
                  {task.status === 'downloading' || task.status === 'queued' ? (
                    <Button
                      size="compact-sm"
                      variant="default"
                      leftSection={<IconPlayerPause size={15} />}
                      onClick={() => void control('pause')}
                    >
                      {t('暂停')}
                    </Button>
                  ) : task.status === 'paused' || task.status === 'failed' ? (
                    <Button
                      size="compact-sm"
                      variant="default"
                      leftSection={<IconPlayerPlay size={15} />}
                      onClick={() => void control('resume')}
                    >
                      {t('继续')}
                    </Button>
                  ) : null}
                  {!isTerminal(task.status) ? (
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label={t('取消下载')}
                      onClick={() => void control('cancel')}
                    >
                      <IconX size={17} />
                    </ActionIcon>
                  ) : (
                    <ActionIcon variant="subtle" aria-label={t('移除记录')} onClick={() => void removeTask(task)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  )}
                </Group>
              )}
            </section>
          )
        })}
      </Stack>
    </main>
  )
}
