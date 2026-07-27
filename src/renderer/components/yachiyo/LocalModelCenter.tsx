import { Capacitor } from '@capacitor/core'
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Progress,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import type {
  CompatibilityReport,
  DeviceCompatibilityProfile,
  DownloadJob,
  ModelCatalogSource,
  RemoteModel,
} from '@shared/models/model-catalog'
import { ModelProviderEnum } from '@shared/types'
import {
  IconArrowLeft,
  IconCheck,
  IconCpu,
  IconDatabase,
  IconDownload,
  IconPlayerPause,
  IconPlayerPlay,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type DownloadSample, updateDownloadEstimate } from '@/mobile/model-download-metrics'
import { syncInstalledLocalModelsIntoSettings } from '@/mobile/local-model-provider-sync'
import {
  buildSelectedLocalModel,
  listRunnableLocalModelArtifacts,
  localModelRuntimeForArtifact,
  resolveLocalModelArtifactGroup,
} from '@/mobile/local-model-artifacts'
import { createMobileModelCatalogController, searchMobileModelCatalog } from '@/mobile/model-catalog-controller'
import {
  deleteNativeModel,
  getNativeModelDeviceProfile,
  getNativeModelRuntimeState,
  loadNativeModel,
  listNativeModelJobs,
  type NativeModelLoadProgressEvent,
  subscribeNativeModelLoadProgress,
  yachiyoModelManagerNative,
} from '@/platform/native/yachiyo_model_manager'
import { persistSettingsPatch, useSettingsStore } from '@/stores/settingsStore'
import { router } from '@/router'
import './local-model-center.css'

type SourceFilter = 'all' | ModelCatalogSource
type ModelCenterView = 'community' | 'installed'
type ModelHealth = { status: 'supported' | 'warning' | 'unsupported' | 'unknown'; reason?: string }
type ModelRuntimeState = {
  loaded: boolean
  loading: boolean
  stage?: string
  percent: number
  runtime?: string
  error?: string
}
type Translate = (key: string, options?: Record<string, unknown>) => string
const controller = createMobileModelCatalogController()
const MAX_MODEL_BYTES = 15 * 1024 ** 3

function formatBytes(t: Translate, value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return t('未知')
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** exponent).toFixed(exponent >= 3 ? 1 : 0)} ${units[exponent]}`
}

function formatDuration(t: Translate, value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return t('正在估算')
  const seconds = Math.ceil(value)
  if (seconds < 60) return t('{{seconds}} 秒', { seconds })
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return t('{{minutes}} 分钟', { minutes })
  const hours = Math.floor(minutes / 60)
  return t('{{hours}} 小时 {{minutes}} 分钟', { hours, minutes: minutes % 60 })
}

function downloadStatusLabel(t: Translate, status: DownloadJob['status']): string {
  if (status === 'queued') return t('等待下载')
  if (status === 'downloading') return t('正在下载')
  if (status === 'paused') return t('已暂停')
  if (status === 'completed') return t('已完成')
  if (status === 'failed') return t('下载失败')
  return t('已取消')
}

function formatParameters(t: Translate, value?: number): string {
  if (!value) return t('未知')
  return value >= 1_000_000_000 ? `${(value / 1_000_000_000).toFixed(1)}B` : `${Math.round(value / 1_000_000)}M`
}

function sourceLabel(t: Translate, source: ModelCatalogSource): string {
  return source === 'huggingface' ? 'Hugging Face' : t('魔搭社区')
}

function reportLabel(t: Translate, report?: CompatibilityReport) {
  if (report?.status === 'supported') return { label: t('预计可流畅运行'), color: 'green' }
  if (report?.status === 'warning') return { label: t('预计可以运行'), color: 'yellow' }
  if (report?.status === 'unsupported') return { label: t('当前设备不建议运行'), color: 'red' }
  return { label: t('等待设备评估'), color: 'gray' }
}

function runtimeStageLabel(t: Translate, stage?: string): string {
  if (stage === 'starting') return t('正在启动独立推理进程')
  if (stage === 'loading') return t('正在将模型加载到内存')
  if (stage === 'generating') return t('模型正在生成')
  if (stage === 'embedding') return t('正在初始化嵌入模型')
  if (stage === 'ready') return t('模型已加载到内存')
  return t('正在准备本地推理运行时')
}

export function LocalModelCenter() {
  const { t: i18nT } = useTranslation()
  const t = i18nT as Translate
  const [view, setView] = useState<ModelCenterView>('community')
  const [query, setQuery] = useState('gguf')
  const [source, setSource] = useState<SourceFilter>('all')
  const [models, setModels] = useState<RemoteModel[]>([])
  const [selected, setSelected] = useState<RemoteModel>()
  const [detail, setDetail] = useState<RemoteModel>()
  const [profile, setProfile] = useState<DeviceCompatibilityProfile>()
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [downloadQueueOpened, setDownloadQueueOpened] = useState(false)
  const [downloadMetrics, setDownloadMetrics] = useState<
    Record<string, { bytesPerSecond: number; remainingSeconds?: number }>
  >({})
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [queueError, setQueueError] = useState('')
  const [pendingJobIds, setPendingJobIds] = useState<Set<string>>(() => new Set())
  const [healthByModelId, setHealthByModelId] = useState<Record<string, ModelHealth>>({})
  const [runtimeByModelId, setRuntimeByModelId] = useState<Record<string, ModelRuntimeState>>({})
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>()
  const searchAbortRef = useRef<AbortController>()
  const downloadSamplesRef = useRef<Record<string, DownloadSample>>({})
  const refreshRunIdRef = useRef(0)
  const defaultChatModel = useSettingsStore((state) => state.defaultChatModel)

  const refreshJobs = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return
    const runId = ++refreshRunIdRef.current
    try {
      const nextJobs = (await listNativeModelJobs()).jobs
      if (runId !== refreshRunIdRef.current) return
      const capturedAt = Date.now()
      const nextMetrics: Record<string, { bytesPerSecond: number; remainingSeconds?: number }> = {}
      const nextSamples: Record<string, DownloadSample> = {}
      for (const job of nextJobs) {
        const estimate = updateDownloadEstimate(job, downloadSamplesRef.current[job.id], capturedAt)
        nextSamples[job.id] = estimate.sample
        nextMetrics[job.id] = {
          bytesPerSecond: estimate.bytesPerSecond,
          remainingSeconds: estimate.remainingSeconds,
        }
      }
      downloadSamplesRef.current = nextSamples
      await syncInstalledLocalModelsIntoSettings(nextJobs)
      setDownloadMetrics(nextMetrics)
      setJobs(nextJobs)
    } catch (cause) {
      if (runId === refreshRunIdRef.current) {
        setQueueError(cause instanceof Error ? cause.message : t('无法刷新下载队列'))
      }
    }
  }, [t])

  const runJobAction = useCallback(
    async (jobId: string, action: () => Promise<unknown>) => {
      setPendingJobIds((current) => new Set(current).add(jobId))
      setQueueError('')
      try {
        await action()
        await refreshJobs()
      } catch (cause) {
        setQueueError(cause instanceof Error ? cause.message : t('下载操作失败'))
      } finally {
        setPendingJobIds((current) => {
          const next = new Set(current)
          next.delete(jobId)
          return next
        })
      }
    },
    [refreshJobs, t],
  )

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    void getNativeModelDeviceProfile()
      .then(setProfile)
      .catch(() => undefined)
    void refreshJobs()
    const timer = window.setInterval(() => void refreshJobs(), 1500)
    return () => window.clearInterval(timer)
  }, [refreshJobs])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let handle: { remove: () => Promise<void> } | undefined
    void subscribeNativeModelLoadProgress((event: NativeModelLoadProgressEvent) => {
      setRuntimeByModelId((current) => ({
        ...current,
        [event.modelId]: {
          ...(current[event.modelId] || { loaded: false, loading: true, percent: 0 }),
          loading: event.stage !== 'ready' && event.stage !== 'idle',
          loaded: event.stage === 'ready' || current[event.modelId]?.loaded === true,
          stage: event.stage,
          percent: Math.max(0, Math.min(100, event.percent)),
          error: undefined,
        },
      }))
    }).then((listener) => {
      handle = listener
    })
    return () => void handle?.remove()
  }, [])

  const search = useCallback(
    async (selectedSource: SourceFilter = source) => {
      searchAbortRef.current?.abort()
      const searchAbort = new AbortController()
      searchAbortRef.current = searchAbort
      setLoading(true)
      setError('')
      setModels([])
      try {
        const sources: ModelCatalogSource[] =
          selectedSource === 'all' ? ['huggingface', 'modelscope'] : [selectedSource]
        const result = await searchMobileModelCatalog(
          controller,
          sources,
          { query: query.trim() || 'litertlm', limit: 30 },
          { signal: searchAbort.signal },
        )
        if (searchAbort.signal.aborted) return
        const found = result.models
        setModels(found.sort((left, right) => (right.downloads || 0) - (left.downloads || 0)))
        if (!found.length)
          setError(
            result.failures.length === sources.length
              ? sources.length === 1
                ? t('{{source}} 当前无法访问，请稍后重试。', { source: sourceLabel(t, sources[0]) })
                : t('两个模型平台当前都无法访问，请稍后重试。')
              : t('没有找到匹配模型。'),
          )
      } catch (cause) {
        if (searchAbort.signal.aborted) return
        setError(cause instanceof Error ? cause.message : t('模型搜索失败'))
      } finally {
        if (searchAbortRef.current === searchAbort) setLoading(false)
      }
    },
    [query, source, t],
  )

  useEffect(() => () => searchAbortRef.current?.abort(), [])

  useEffect(() => {
    void search()
  }, [])

  const openDetail = async (model: RemoteModel) => {
    setSelected(model)
    setDetail(undefined)
    setDetailLoading(true)
    setError('')
    try {
      const complete = await controller.getModel(model.source, model.repository, {
        revision: model.revision,
        includeArtifacts: true,
      })
      setDetail(complete)
      setSelectedArtifactId(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('模型详情加载失败'))
    } finally {
      setDetailLoading(false)
    }
  }

  const activeModel = detail || selected
  const activeJob = activeModel
    ? jobs.find((job) => job.modelId === activeModel.id && job.status !== 'cancelled')
    : undefined
  const runnableArtifacts = useMemo(
    () => listRunnableLocalModelArtifacts(detail?.artifacts || [], MAX_MODEL_BYTES),
    [detail],
  )
  const artifact = useMemo(
    () => runnableArtifacts.find((item) => item.id === selectedArtifactId) || runnableArtifacts[0],
    [runnableArtifacts, selectedArtifactId],
  )
  const artifactGroup = useMemo(
    () => (artifact && detail ? resolveLocalModelArtifactGroup(artifact, detail.artifacts, MAX_MODEL_BYTES) : []),
    [artifact, detail],
  )
  const artifactGroupBytes = artifactGroup.reduce((total, item) => total + (item.sizeBytes || 0), 0)
  const selectedLocalModel = useMemo(
    () => (detail && artifactGroup.length > 0 ? buildSelectedLocalModel(detail, artifactGroup) : undefined),
    [artifactGroup, detail],
  )
  const report = useMemo(
    () => (selectedLocalModel && profile ? controller.checkCompatibility(selectedLocalModel, profile) : undefined),
    [profile, selectedLocalModel],
  )
  const downloadJobs = useMemo(() => {
    const statusOrder: Record<DownloadJob['status'], number> = {
      downloading: 0,
      queued: 1,
      paused: 2,
      failed: 3,
      completed: 4,
      cancelled: 5,
    }
    return [...jobs].sort(
      (left, right) => statusOrder[left.status] - statusOrder[right.status] || right.updatedAt - left.updatedAt,
    )
  }, [jobs])
  const activeDownloadCount = jobs.filter((job) => job.status === 'queued' || job.status === 'downloading').length
  const installedJobs = useMemo(() => {
    const latestByModel = new Map<string, DownloadJob>()
    for (const job of jobs) {
      if (job.status !== 'completed') continue
      const existing = latestByModel.get(job.modelId)
      if (!existing || existing.updatedAt < job.updatedAt) latestByModel.set(job.modelId, job)
    }
    return [...latestByModel.values()].sort((left, right) => right.updatedAt - left.updatedAt)
  }, [jobs])

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || view !== 'installed' || installedJobs.length === 0) return
    let active = true
    void Promise.all(
      installedJobs.map(async (job) => {
        try {
          const [health, runtime] = await Promise.all([
            yachiyoModelManagerNative.healthCheck({ modelId: job.modelId }),
            getNativeModelRuntimeState(job.modelId),
          ])
          return [job.modelId, health, runtime] as const
        } catch (cause) {
          return [
            job.modelId,
            {
              status: 'unknown',
              reason: cause instanceof Error ? cause.message : t('运行时检查失败'),
            } satisfies ModelHealth,
            { loaded: false },
          ] as const
        }
      }),
    ).then((entries) => {
      if (!active) return
      setHealthByModelId(Object.fromEntries(entries.map(([modelId, health]) => [modelId, health])))
      setRuntimeByModelId((current) => ({
        ...current,
        ...Object.fromEntries(
          entries.map(([modelId, , runtime]) => [
            modelId,
            {
              loaded: runtime.loaded,
              loading: false,
              stage: runtime.loaded ? 'ready' : 'idle',
              percent: runtime.loaded ? 100 : 0,
              runtime: 'runtime' in runtime ? runtime.runtime : undefined,
            },
          ]),
        ),
      }))
    })
    return () => {
      active = false
    }
  }, [installedJobs, t, view])

  const startDownload = async () => {
    if (!selectedLocalModel || !profile || !artifact || artifactGroup.length === 0) return
    setError('')
    try {
      await controller.createDownloadJob({
        model: selectedLocalModel,
        device: profile,
        runtime: localModelRuntimeForArtifact(artifact),
        artifactIds: artifactGroup.map((item) => item.id),
        allowIncompatible: false,
      })
      await refreshJobs()
      void router.navigate({ to: '/settings/downloads' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('无法创建下载任务'))
    }
  }

  const setAsDefault = async () => {
    if (activeModel)
      await persistSettingsPatch({ defaultChatModel: { provider: ModelProviderEnum.Local, model: activeModel.id } })
  }

  const removeDownloadedModel = async (modelId: string) => {
    await deleteNativeModel(modelId)
    setRuntimeByModelId((current) => {
      const next = { ...current }
      delete next[modelId]
      return next
    })
    await refreshJobs()
  }

  const loadIntoMemory = async (modelId: string) => {
    setRuntimeByModelId((current) => ({
      ...Object.fromEntries(Object.entries(current).map(([id, state]) => [id, { ...state, loaded: false }])),
      [modelId]: { loaded: false, loading: true, stage: 'starting', percent: 0 },
    }))
    try {
      const result = await loadNativeModel(modelId)
      setRuntimeByModelId((current) => ({
        ...Object.fromEntries(Object.entries(current).map(([id, state]) => [id, { ...state, loaded: false }])),
        [modelId]: {
          loaded: result.loaded,
          loading: false,
          stage: result.loaded ? 'ready' : 'idle',
          percent: result.loaded ? 100 : 0,
          runtime: result.runtime,
        },
      }))
    } catch (cause) {
      setRuntimeByModelId((current) => ({
        ...current,
        [modelId]: {
          loaded: false,
          loading: false,
          stage: 'idle',
          percent: 0,
          error: cause instanceof Error ? cause.message : t('模型加载失败'),
        },
      }))
      throw cause
    }
  }

  const unloadRuntime = async () => {
    await yachiyoModelManagerNative.unload()
    setRuntimeByModelId((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, state]) => [
          id,
          { ...state, loaded: false, loading: false, stage: 'idle', percent: 0 },
        ]),
      ),
    )
  }

  const removeModel = async () => {
    if (activeModel) await removeDownloadedModel(activeModel.id)
  }

  const setInstalledAsDefault = async (modelId: string) => {
    await persistSettingsPatch({ defaultChatModel: { provider: ModelProviderEnum.Local, model: modelId } })
  }

  if (view === 'installed' && !downloadQueueOpened) {
    return (
      <main className="local-model-center local-model-installed">
        <header className="local-model-heading">
          <div>
            <Text className="local-model-eyebrow">ON-DEVICE MODELS</Text>
            <Title order={1}>{t('已安装模型')}</Title>
            <Text c="dimmed">{t('管理已下载到应用私有目录的模型和运行时。')}</Text>
          </div>
          <ActionIcon
            className="local-model-queue-trigger"
            size={42}
            radius="xl"
            variant="default"
            aria-label={t('打开下载队列')}
            onClick={() => void router.navigate({ to: '/settings/downloads' })}
          >
            <IconDownload size={21} />
            {activeDownloadCount > 0 && (
              <span className="local-model-queue-count">{activeDownloadCount > 9 ? '9+' : activeDownloadCount}</span>
            )}
          </ActionIcon>
        </header>
        <SegmentedControl
          fullWidth
          radius="xl"
          value={view}
          onChange={(value) => setView(value as ModelCenterView)}
          data={[
            { label: t('模型社区'), value: 'community' },
            { label: t('已安装 ({{count}})', { count: installedJobs.length }), value: 'installed' },
          ]}
        />
        {queueError && (
          <Text c="red" size="sm" role="alert">
            {queueError}
          </Text>
        )}
        {installedJobs.length === 0 ? (
          <section className="local-model-queue-empty">
            <IconDatabase size={34} />
            <Text fw={700}>{t('还没有已安装模型')}</Text>
            <Text size="sm" c="dimmed">
              {t('从模型社区选择 GGUF、LiteRT-LM 或嵌入模型并完成下载。')}
            </Text>
            <Button radius="xl" color="chatbox-brand" onClick={() => setView('community')}>
              {t('浏览模型社区')}
            </Button>
          </section>
        ) : (
          <div className="local-model-installed-list">
            {installedJobs.map((job) => {
              const health = healthByModelId[job.modelId]
              const format = job.artifacts
                .map((item) => item.format)
                .filter((item, index, all) => all.indexOf(item) === index)
              const runtime =
                job.artifacts.find((item) => item.runtime)?.runtime ||
                (job.artifacts.some((item) => item.format === 'gguf') ? 'llama.cpp' : t('未识别'))
              const quantization = job.artifacts
                .map((item) => item.filename.match(/(?:^|[-_.])(Q\d(?:_[A-Z0-9]+)?)(?:[-_.]|$)/i)?.[1])
                .find(Boolean)
              const isDefault =
                defaultChatModel?.provider === ModelProviderEnum.Local && defaultChatModel.model === job.modelId
              const pending = pendingJobIds.has(job.id)
              const runtimeState = runtimeByModelId[job.modelId]
              return (
                <section key={job.modelId} className="local-model-installed-row">
                  <div className="local-model-installed-heading">
                    <div>
                      <Text fw={750} className="local-model-installed-name">
                        {job.repository.split('/').at(-1) || job.repository}
                      </Text>
                      <Text size="xs" c="dimmed" className="local-model-installed-repository">
                        {job.repository}
                      </Text>
                    </div>
                    <Group gap={6}>
                      {isDefault && (
                        <Badge color="chatbox-brand" variant="light">
                          {t('默认')}
                        </Badge>
                      )}
                      <Badge
                        color={
                          health?.status === 'supported'
                            ? 'green'
                            : health?.status === 'warning'
                              ? 'yellow'
                              : health?.status === 'unsupported'
                                ? 'red'
                                : 'gray'
                        }
                        variant="light"
                      >
                        {health?.status === 'supported'
                          ? t('可运行')
                          : health?.status === 'warning'
                            ? t('可运行，有警告')
                            : health?.status === 'unsupported'
                              ? t('不可运行')
                              : t('正在检查')}
                      </Badge>
                    </Group>
                  </div>
                  <div className="local-model-installed-meta">
                    <span>{format.join(' + ') || t('未知格式')}</span>
                    <span>{runtime}</span>
                    <span>{quantization || t('量化信息未声明')}</span>
                    <span>{formatBytes(t, job.bytesTotal)}</span>
                  </div>
                  {health?.reason && (
                    <Text size="xs" c={health.status === 'unsupported' ? 'red' : 'dimmed'}>
                      {health.reason}
                    </Text>
                  )}
                  {(runtimeState?.loading || runtimeState?.error) && (
                    <div className="local-model-runtime-progress">
                      <Group justify="space-between" gap="sm" wrap="nowrap">
                        <Text size="xs" fw={650} c={runtimeState.error ? 'red' : undefined}>
                          {runtimeState.error || runtimeStageLabel(t, runtimeState.stage)}
                        </Text>
                        {!runtimeState.error && (
                          <Text size="xs" c="dimmed">
                            {runtimeState.percent}%
                          </Text>
                        )}
                      </Group>
                      {!runtimeState.error && (
                        <Progress
                          value={runtimeState.percent}
                          animated={runtimeState.percent < 100}
                          radius="xl"
                          color="chatbox-brand"
                        />
                      )}
                    </div>
                  )}
                  <Group gap="xs" justify="flex-end">
                    {!job.artifacts.some((item) => item.format === 'tflite') && (
                      <Button
                        size="compact-sm"
                        radius="xl"
                        color="chatbox-brand"
                        variant={isDefault ? 'light' : 'filled'}
                        disabled={isDefault || health?.status === 'unsupported'}
                        onClick={() => void setInstalledAsDefault(job.modelId)}
                      >
                        {isDefault ? t('当前默认') : t('设为默认')}
                      </Button>
                    )}
                    <Button
                      size="compact-sm"
                      radius="xl"
                      color={runtimeState?.loaded ? 'green' : 'chatbox-brand'}
                      variant={runtimeState?.loaded ? 'light' : 'filled'}
                      leftSection={!runtimeState?.loaded ? <IconPlayerPlay size={15} /> : <IconCheck size={15} />}
                      loading={runtimeState?.loading}
                      disabled={pending || runtimeState?.loaded || health?.status === 'unsupported'}
                      onClick={() => void runJobAction(job.id, () => loadIntoMemory(job.modelId))}
                    >
                      {runtimeState?.loaded ? t('已加载') : runtimeState?.loading ? t('加载中') : t('加载到内存')}
                    </Button>
                    <Button
                      size="compact-sm"
                      radius="xl"
                      variant="default"
                      disabled={pending || !runtimeState?.loaded}
                      onClick={() => void runJobAction(job.id, unloadRuntime)}
                    >
                      {t('卸载内存')}
                    </Button>
                    <ActionIcon
                      size={30}
                      variant="subtle"
                      color="red"
                      aria-label={t('删除 {{repository}}', { repository: job.repository })}
                      disabled={pending}
                      onClick={() => void runJobAction(job.id, () => removeDownloadedModel(job.modelId))}
                    >
                      <IconTrash size={17} />
                    </ActionIcon>
                  </Group>
                </section>
              )
            })}
          </div>
        )}
      </main>
    )
  }

  if (downloadQueueOpened) {
    return (
      <main className="local-model-center local-model-download-queue">
        <header className="local-model-queue-heading">
          <Group gap="sm" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              color="gray"
              size={38}
              aria-label={t('返回本地模型')}
              onClick={() => setDownloadQueueOpened(false)}
            >
              <IconArrowLeft size={22} />
            </ActionIcon>
            <div>
              <Title order={2}>{t('下载队列')}</Title>
              <Text c="dimmed" size="sm">
                {t('退出此页面后下载仍会在后台继续')}
              </Text>
            </div>
          </Group>
          <Badge color={activeDownloadCount ? 'chatbox-brand' : 'gray'} variant="light" radius="xl">
            {activeDownloadCount ? t('{{count}} 个正在下载', { count: activeDownloadCount }) : t('当前无下载')}
          </Badge>
        </header>

        {queueError && (
          <Text c="red" size="sm" role="alert">
            {queueError}
          </Text>
        )}

        {downloadJobs.length === 0 ? (
          <section className="local-model-queue-empty">
            <IconDownload size={34} />
            <Text fw={700}>{t('还没有下载任务')}</Text>
            <Text size="sm" c="dimmed">
              {t('在模型详情中选择兼容文件开始下载。')}
            </Text>
          </section>
        ) : (
          <div className="local-model-queue-list" aria-live="polite">
            {downloadJobs.map((job) => {
              const progress = job.bytesTotal > 0 ? (job.bytesDownloaded / job.bytesTotal) * 100 : 0
              const metric = downloadMetrics[job.id]
              const canPause = job.status === 'queued' || job.status === 'downloading'
              const canResume = job.status === 'paused' || job.status === 'failed'
              const canCancel = canPause || canResume
              const pending = pendingJobIds.has(job.id)
              return (
                <section key={job.id} className="local-model-queue-row" data-status={job.status}>
                  <div className="local-model-queue-row-heading">
                    <div>
                      <strong>{job.repository.split('/').at(-1) || job.repository}</strong>
                      <small>{job.artifacts[0]?.filename || job.repository}</small>
                    </div>
                    <Badge
                      color={
                        job.status === 'failed'
                          ? 'red'
                          : job.status === 'completed'
                            ? 'green'
                            : job.status === 'paused'
                              ? 'yellow'
                              : job.status === 'cancelled'
                                ? 'gray'
                                : 'chatbox-brand'
                      }
                      variant="light"
                      radius="xl"
                    >
                      {downloadStatusLabel(t, job.status)}
                    </Badge>
                  </div>
                  <Progress
                    value={progress}
                    color={job.status === 'failed' ? 'red' : job.status === 'completed' ? 'green' : 'chatbox-brand'}
                    radius="xl"
                    animated={job.status === 'downloading'}
                  />
                  <div className="local-model-queue-stats">
                    <span>
                      {formatBytes(t, job.bytesDownloaded)} / {formatBytes(t, job.bytesTotal)}
                    </span>
                    {job.status === 'downloading' && (
                      <span>
                        {metric?.bytesPerSecond ? `${formatBytes(t, metric.bytesPerSecond)}/s` : t('正在连接')} ·{' '}
                        {formatDuration(t, metric?.remainingSeconds)}
                      </span>
                    )}
                    <strong>{progress.toFixed(1)}%</strong>
                  </div>
                  {job.error?.message && job.status === 'failed' && (
                    <Text size="xs" c="red">
                      {job.error.message}
                    </Text>
                  )}
                  <Group gap="xs" justify="flex-end">
                    {canPause && (
                      <Button
                        size="compact-sm"
                        variant="default"
                        leftSection={<IconPlayerPause size={16} />}
                        loading={pending}
                        onClick={() =>
                          void runJobAction(job.id, () => yachiyoModelManagerNative.pause({ jobId: job.id }))
                        }
                      >
                        {t('暂停')}
                      </Button>
                    )}
                    {canResume && (
                      <Button
                        size="compact-sm"
                        variant="default"
                        leftSection={<IconPlayerPlay size={16} />}
                        loading={pending}
                        onClick={() =>
                          void runJobAction(job.id, () => yachiyoModelManagerNative.resume({ jobId: job.id }))
                        }
                      >
                        {t('继续')}
                      </Button>
                    )}
                    {canCancel && (
                      <ActionIcon
                        size={30}
                        variant="subtle"
                        color="red"
                        aria-label={t('取消下载')}
                        disabled={pending}
                        onClick={() =>
                          void runJobAction(job.id, () => yachiyoModelManagerNative.cancel({ jobId: job.id }))
                        }
                      >
                        <IconX size={17} />
                      </ActionIcon>
                    )}
                    {job.status === 'completed' && (
                      <ActionIcon
                        size={30}
                        variant="subtle"
                        color="red"
                        aria-label={t('删除本地模型')}
                        disabled={pending}
                        onClick={() => void runJobAction(job.id, () => removeDownloadedModel(job.modelId))}
                      >
                        <IconTrash size={17} />
                      </ActionIcon>
                    )}
                  </Group>
                </section>
              )
            })}
          </div>
        )}
      </main>
    )
  }

  if (activeModel) {
    const compatibility = reportLabel(t, report)
    const progress = activeJob?.bytesTotal ? (activeJob.bytesDownloaded / activeJob.bytesTotal) * 100 : 0
    return (
      <main className="local-model-center local-model-detail">
        <Group gap="sm" wrap="nowrap">
          <ActionIcon
            variant="subtle"
            color="gray"
            size={38}
            aria-label={t('返回模型列表')}
            onClick={() => setSelected(undefined)}
          >
            <IconArrowLeft size={22} />
          </ActionIcon>
          <div className="local-model-detail-title">
            <Title order={2}>{activeModel.displayName || activeModel.name}</Title>
            <Text c="dimmed" size="sm">
              {activeModel.repository}
            </Text>
          </div>
        </Group>
        {detailLoading ? (
          <Loader color="chatbox-brand" className="local-model-loader" />
        ) : (
          <Stack gap="md">
            <section className="local-model-summary-grid">
              <div>
                <small>{t('参数量')}</small>
                <strong>{formatParameters(t, activeModel.parameterCount)}</strong>
              </div>
              <div>
                <small>{t('模型文件')}</small>
                <strong>
                  {formatBytes(t, artifactGroupBytes || artifact?.sizeBytes || activeModel.storageSizeBytes)}
                </strong>
              </div>
              <div>
                <small>{t('上下文')}</small>
                <strong>
                  {activeModel.contextLength ? `${activeModel.contextLength.toLocaleString()} tokens` : t('未知')}
                </strong>
              </div>
              <div>
                <small>{t('格式')}</small>
                <strong>{activeModel.formats.join(', ') || t('未知')}</strong>
              </div>
            </section>
            {runnableArtifacts.length > 0 && (
              <Select
                label={t('模型文件与量化')}
                description={t('GGUF 会使用 llama.cpp 在本机运行；分片模型会下载完整分片组。')}
                value={artifact?.id || null}
                allowDeselect={false}
                searchable
                data={runnableArtifacts.map((item) => ({
                  value: item.id,
                  label: `${item.filename} · ${formatBytes(t, item.sizeBytes)}`,
                }))}
                onChange={(value) => setSelectedArtifactId(value || undefined)}
              />
            )}
            <section className="local-model-compatibility" data-status={report?.status || 'unknown'}>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={700}>{t('设备运行评估')}</Text>
                  <Text size="sm" c="dimmed">
                    {profile?.soc || profile?.cpu || t('正在读取设备信息')}
                  </Text>
                </div>
                <Badge color={compatibility.color} variant="light" radius="xl">
                  {compatibility.label}
                </Badge>
              </Group>
              <div className="local-model-device-metrics">
                <span>
                  <IconCpu size={17} />{' '}
                  {t('RAM {{available}} 可用 / {{total}} 总计', {
                    available: formatBytes(t, profile?.availableRamBytes),
                    total: formatBytes(t, profile?.ramBytes),
                  })}
                </span>
                <span>
                  <IconDatabase size={17} />{' '}
                  {t('可用存储 {{storage}}', { storage: formatBytes(t, profile?.availableStorageBytes) })}
                </span>
              </div>
              {report?.issues.map((issue) => (
                <Text key={issue.code} size="sm" c={issue.severity === 'error' ? 'red' : 'yellow.8'}>
                  {issue.message}
                </Text>
              ))}
            </section>
            <section className="local-model-metadata">
              <div>
                <span>{t('来源')}</span>
                <strong>{sourceLabel(t, activeModel.source)}</strong>
              </div>
              <div>
                <span>{t('架构')}</span>
                <strong>{activeModel.architecture.join(', ') || t('未声明')}</strong>
              </div>
              <div>
                <span>{t('量化')}</span>
                <strong>{activeModel.quantization || t('模型包内定义')}</strong>
              </div>
              <div>
                <span>{t('许可证')}</span>
                <strong>{activeModel.license || t('请查看模型卡')}</strong>
              </div>
              <div>
                <span>{t('固定版本')}</span>
                <strong>{activeModel.revision.slice(0, 12)}</strong>
              </div>
            </section>
            {activeJob && ['queued', 'downloading', 'paused', 'failed'].includes(activeJob.status) && (
              <section className="local-model-download-state">
                <Group justify="space-between">
                  <Text fw={600}>
                    {activeJob.status === 'paused'
                      ? t('已暂停')
                      : activeJob.status === 'failed'
                        ? t('下载失败')
                        : t('正在下载')}
                  </Text>
                  <Text size="sm">{progress.toFixed(1)}%</Text>
                </Group>
                <Progress
                  value={progress}
                  color="chatbox-brand"
                  radius="xl"
                  animated={activeJob.status === 'downloading'}
                />
                <Text size="xs" c="dimmed">
                  {formatBytes(t, activeJob.bytesDownloaded)} / {formatBytes(t, activeJob.bytesTotal)}
                </Text>
                {activeJob.status === 'downloading' || activeJob.status === 'queued' ? (
                  <Button
                    variant="default"
                    leftSection={<IconPlayerPause size={17} />}
                    loading={pendingJobIds.has(activeJob.id)}
                    onClick={() =>
                      void runJobAction(activeJob.id, () => yachiyoModelManagerNative.pause({ jobId: activeJob.id }))
                    }
                  >
                    {t('暂停')}
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    leftSection={<IconPlayerPlay size={17} />}
                    loading={pendingJobIds.has(activeJob.id)}
                    onClick={() =>
                      void runJobAction(activeJob.id, () => yachiyoModelManagerNative.resume({ jobId: activeJob.id }))
                    }
                  >
                    {t('继续')}
                  </Button>
                )}
              </section>
            )}
            {activeJob?.status === 'completed' ? (
              <Group grow>
                {artifact?.format !== 'tflite' && (
                  <Button
                    radius="xl"
                    color="chatbox-brand"
                    leftSection={<IconCheck size={18} />}
                    onClick={() => void setAsDefault()}
                  >
                    {t('设为聊天模型')}
                  </Button>
                )}
                <Button
                  radius="xl"
                  variant="default"
                  color="red"
                  leftSection={<IconTrash size={18} />}
                  loading={pendingJobIds.has(activeJob.id)}
                  onClick={() => void runJobAction(activeJob.id, removeModel)}
                >
                  {t('删除')}
                </Button>
              </Group>
            ) : (
              <Button
                radius="xl"
                color="chatbox-brand"
                size="md"
                leftSection={<IconDownload size={19} />}
                disabled={
                  !artifact || artifactGroup.length === 0 || report?.status === 'unsupported' || Boolean(activeJob)
                }
                onClick={() => void startDownload()}
              >
                {artifact
                  ? t('下载到应用目录 · {{size}}', { size: formatBytes(t, artifactGroupBytes || artifact.sizeBytes) })
                  : t('没有可验证的 GGUF / LiteRT-LM / TFLite 文件')}
              </Button>
            )}
            {(error || queueError) && (
              <Text c="red" size="sm">
                {error || queueError}
              </Text>
            )}
          </Stack>
        )}
      </main>
    )
  }

  return (
    <main className="local-model-center">
      <header className="local-model-heading">
        <div>
          <Text className="local-model-eyebrow">ON-DEVICE MODELS</Text>
          <Title order={1}>{t('发现本地模型')}</Title>
          <Text c="dimmed">{t('搜索可在 Android 设备上离线运行的模型。')}</Text>
        </div>
        <ActionIcon
          className="local-model-queue-trigger"
          size={42}
          radius="xl"
          variant="default"
          aria-label={t('打开下载队列')}
          onClick={() => void router.navigate({ to: '/settings/downloads' })}
        >
          <IconDownload size={21} />
          {activeDownloadCount > 0 && (
            <span className="local-model-queue-count">{activeDownloadCount > 9 ? '9+' : activeDownloadCount}</span>
          )}
        </ActionIcon>
      </header>
      <SegmentedControl
        fullWidth
        radius="xl"
        value={view}
        onChange={(value) => setView(value as ModelCenterView)}
        data={[
          { label: t('模型社区'), value: 'community' },
          { label: t('已安装 ({{count}})', { count: installedJobs.length }), value: 'installed' },
        ]}
      />
      <div className="local-model-searchbar">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void search()
          }}
          leftSection={<IconSearch size={19} />}
          placeholder={t('搜索模型，例如 Gemma 3、Qwen 2.5')}
          radius="xl"
          size="md"
        />
        <Button radius="xl" color="chatbox-brand" onClick={() => void search()} loading={loading}>
          {t('搜索')}
        </Button>
      </div>
      <SegmentedControl
        fullWidth
        radius="xl"
        value={source}
        onChange={(value) => {
          const nextSource = value as SourceFilter
          setSource(nextSource)
          void search(nextSource)
        }}
        data={[
          { label: t('全部'), value: 'all' },
          { label: 'Hugging Face', value: 'huggingface' },
          { label: t('魔搭社区'), value: 'modelscope' },
        ]}
      />
      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      <div className="local-model-results" aria-busy={loading}>
        {models.map((model) => {
          const installed = jobs.some((job) => job.modelId === model.id && job.status === 'completed')
          return (
            <button
              key={`${model.source}:${model.id}`}
              type="button"
              className="local-model-row"
              onClick={() => void openDetail(model)}
            >
              <span className="local-model-source-mark" data-source={model.source}>
                {model.source === 'huggingface' ? 'HF' : t('魔搭')}
              </span>
              <span className="local-model-row-copy">
                <strong>{model.displayName || model.name}</strong>
                <small>{model.repository}</small>
                <span className="local-model-row-tags">
                  <Badge size="xs" variant="light" color="gray">
                    {formatParameters(t, model.parameterCount)}
                  </Badge>
                  {model.formats.slice(0, 2).map((format) => (
                    <Badge
                      key={format}
                      size="xs"
                      variant="light"
                      color={format === 'litertlm' ? 'chatbox-brand' : 'gray'}
                    >
                      {format}
                    </Badge>
                  ))}
                  {installed && (
                    <Badge size="xs" variant="light" color="green">
                      {t('已下载')}
                    </Badge>
                  )}
                </span>
              </span>
              <span className="local-model-row-meta">
                <strong>{formatBytes(t, model.storageSizeBytes)}</strong>
                <small>
                  {model.downloads
                    ? t('{{count}} 次下载', { count: model.downloads.toLocaleString() })
                    : sourceLabel(t, model.source)}
                </small>
              </span>
            </button>
          )
        })}
        {loading && <Loader color="chatbox-brand" className="local-model-loader" />}
      </div>
    </main>
  )
}
