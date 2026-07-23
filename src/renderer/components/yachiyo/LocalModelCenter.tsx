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
import { ModelProviderEnum, type ProviderModelInfo } from '@shared/types'
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
import { type DownloadSample, updateDownloadEstimate } from '@/mobile/model-download-metrics'
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
  listNativeModelJobs,
  yachiyoModelManagerNative,
} from '@/platform/native/yachiyo_model_manager'
import { persistSettingsPatch, useSettingsStore } from '@/stores/settingsStore'
import './local-model-center.css'

type SourceFilter = 'all' | ModelCatalogSource
const controller = createMobileModelCatalogController()
const MAX_MODEL_BYTES = 15 * 1024 ** 3

function formatBytes(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '未知'
  if (value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** exponent).toFixed(exponent >= 3 ? 1 : 0)} ${units[exponent]}`
}

function formatDuration(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '正在估算'
  const seconds = Math.ceil(value)
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分钟`
}

function downloadStatusLabel(status: DownloadJob['status']): string {
  if (status === 'queued') return '等待下载'
  if (status === 'downloading') return '正在下载'
  if (status === 'paused') return '已暂停'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '下载失败'
  return '已取消'
}

function formatParameters(value?: number): string {
  if (!value) return '未知'
  return value >= 1_000_000_000 ? `${(value / 1_000_000_000).toFixed(1)}B` : `${Math.round(value / 1_000_000)}M`
}

function sourceLabel(source: ModelCatalogSource): string {
  return source === 'huggingface' ? 'Hugging Face' : '魔搭社区'
}

function reportLabel(report?: CompatibilityReport) {
  if (report?.status === 'supported') return { label: '预计可流畅运行', color: 'green' }
  if (report?.status === 'warning') return { label: '预计可以运行', color: 'yellow' }
  if (report?.status === 'unsupported') return { label: '当前设备不建议运行', color: 'red' }
  return { label: '等待设备评估', color: 'gray' }
}

export function LocalModelCenter() {
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
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>()
  const searchAbortRef = useRef<AbortController>()
  const downloadSamplesRef = useRef<Record<string, DownloadSample>>({})
  const refreshRunIdRef = useRef(0)
  const providers = useSettingsStore((state) => state.providers)
  const localModels = providers?.[ModelProviderEnum.Local]?.models || []

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
      setDownloadMetrics(nextMetrics)
      setJobs(nextJobs)
    } catch (cause) {
      if (runId === refreshRunIdRef.current) {
        setQueueError(cause instanceof Error ? cause.message : '无法刷新下载队列')
      }
    }
  }, [])

  const runJobAction = useCallback(
    async (jobId: string, action: () => Promise<unknown>) => {
      setPendingJobIds((current) => new Set(current).add(jobId))
      setQueueError('')
      try {
        await action()
        await refreshJobs()
      } catch (cause) {
        setQueueError(cause instanceof Error ? cause.message : '下载操作失败')
      } finally {
        setPendingJobIds((current) => {
          const next = new Set(current)
          next.delete(jobId)
          return next
        })
      }
    },
    [refreshJobs],
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
    const completed = jobs.filter((job) => job.status === 'completed')
    const current = providers?.[ModelProviderEnum.Local]?.models || []
    const additions: ProviderModelInfo[] = completed
      .filter((job) => !current.some((model) => model.modelId === job.modelId))
      .map((job) => ({
        modelId: job.modelId,
        nickname: job.repository.split('/').at(-1) || job.repository,
        type: job.artifacts.some((artifact) => artifact.format === 'tflite') ? 'embedding' : 'chat',
        capabilities: [],
      }))
    if (!additions.length) return
    void persistSettingsPatch({
      providers: {
        ...(providers || {}),
        [ModelProviderEnum.Local]: {
          ...(providers?.[ModelProviderEnum.Local] || {}),
          models: [...current, ...additions],
        },
      },
    })
  }, [jobs, providers])

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
                ? `${sourceLabel(sources[0])} 当前无法访问，请稍后重试。`
                : '两个模型平台当前都无法访问，请稍后重试。'
              : '没有找到匹配模型。',
          )
      } catch (cause) {
        if (searchAbort.signal.aborted) return
        setError(cause instanceof Error ? cause.message : '模型搜索失败')
      } finally {
        if (searchAbortRef.current === searchAbort) setLoading(false)
      }
    },
    [query, source],
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
      setError(cause instanceof Error ? cause.message : '模型详情加载失败')
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
      setDownloadQueueOpened(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法创建下载任务')
    }
  }

  const setAsDefault = async () => {
    if (activeModel)
      await persistSettingsPatch({ defaultChatModel: { provider: ModelProviderEnum.Local, model: activeModel.id } })
  }

  const removeDownloadedModel = async (modelId: string) => {
    await deleteNativeModel(modelId)
    await persistSettingsPatch({
      providers: {
        ...(providers || {}),
        [ModelProviderEnum.Local]: {
          ...(providers?.[ModelProviderEnum.Local] || {}),
          models: localModels.filter((item) => item.modelId !== modelId),
        },
      },
    })
    await refreshJobs()
  }

  const removeModel = async () => {
    if (activeModel) await removeDownloadedModel(activeModel.id)
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
              aria-label="返回本地模型"
              onClick={() => setDownloadQueueOpened(false)}
            >
              <IconArrowLeft size={22} />
            </ActionIcon>
            <div>
              <Title order={2}>下载队列</Title>
              <Text c="dimmed" size="sm">
                退出此页面后下载仍会在后台继续
              </Text>
            </div>
          </Group>
          <Badge color={activeDownloadCount ? 'pink' : 'gray'} variant="light" radius="xl">
            {activeDownloadCount ? `${activeDownloadCount} 个正在下载` : '当前无下载'}
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
            <Text fw={700}>还没有下载任务</Text>
            <Text size="sm" c="dimmed">
              在模型详情中选择兼容文件开始下载。
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
                                : 'pink'
                      }
                      variant="light"
                      radius="xl"
                    >
                      {downloadStatusLabel(job.status)}
                    </Badge>
                  </div>
                  <Progress
                    value={progress}
                    color={job.status === 'failed' ? 'red' : job.status === 'completed' ? 'green' : 'pink'}
                    radius="xl"
                    animated={job.status === 'downloading'}
                  />
                  <div className="local-model-queue-stats">
                    <span>
                      {formatBytes(job.bytesDownloaded)} / {formatBytes(job.bytesTotal)}
                    </span>
                    {job.status === 'downloading' && (
                      <span>
                        {metric?.bytesPerSecond ? `${formatBytes(metric.bytesPerSecond)}/s` : '正在连接'} ·{' '}
                        {formatDuration(metric?.remainingSeconds)}
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
                        暂停
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
                        继续
                      </Button>
                    )}
                    {canCancel && (
                      <ActionIcon
                        size={30}
                        variant="subtle"
                        color="red"
                        aria-label="取消下载"
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
                        aria-label="删除本地模型"
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
    const compatibility = reportLabel(report)
    const progress = activeJob?.bytesTotal ? (activeJob.bytesDownloaded / activeJob.bytesTotal) * 100 : 0
    return (
      <main className="local-model-center local-model-detail">
        <Group gap="sm" wrap="nowrap">
          <ActionIcon
            variant="subtle"
            color="gray"
            size={38}
            aria-label="返回模型列表"
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
          <Loader color="pink" className="local-model-loader" />
        ) : (
          <Stack gap="md">
            <section className="local-model-summary-grid">
              <div>
                <small>参数量</small>
                <strong>{formatParameters(activeModel.parameterCount)}</strong>
              </div>
              <div>
                <small>模型文件</small>
                <strong>
                  {formatBytes(artifactGroupBytes || artifact?.sizeBytes || activeModel.storageSizeBytes)}
                </strong>
              </div>
              <div>
                <small>上下文</small>
                <strong>
                  {activeModel.contextLength ? `${activeModel.contextLength.toLocaleString()} tokens` : '未知'}
                </strong>
              </div>
              <div>
                <small>格式</small>
                <strong>{activeModel.formats.join(', ') || '未知'}</strong>
              </div>
            </section>
            {runnableArtifacts.length > 0 && (
              <Select
                label="模型文件与量化"
                description="GGUF 会使用 llama.cpp 在本机运行；分片模型会下载完整分片组。"
                value={artifact?.id || null}
                allowDeselect={false}
                searchable
                data={runnableArtifacts.map((item) => ({
                  value: item.id,
                  label: `${item.filename} · ${formatBytes(item.sizeBytes)}`,
                }))}
                onChange={(value) => setSelectedArtifactId(value || undefined)}
              />
            )}
            <section className="local-model-compatibility" data-status={report?.status || 'unknown'}>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={700}>设备运行评估</Text>
                  <Text size="sm" c="dimmed">
                    {profile?.soc || profile?.cpu || '正在读取设备信息'}
                  </Text>
                </div>
                <Badge color={compatibility.color} variant="light" radius="xl">
                  {compatibility.label}
                </Badge>
              </Group>
              <div className="local-model-device-metrics">
                <span>
                  <IconCpu size={17} /> RAM {formatBytes(profile?.availableRamBytes)} 可用 /{' '}
                  {formatBytes(profile?.ramBytes)} 总计
                </span>
                <span>
                  <IconDatabase size={17} /> 可用存储 {formatBytes(profile?.availableStorageBytes)}
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
                <span>来源</span>
                <strong>{sourceLabel(activeModel.source)}</strong>
              </div>
              <div>
                <span>架构</span>
                <strong>{activeModel.architecture.join(', ') || '未声明'}</strong>
              </div>
              <div>
                <span>量化</span>
                <strong>{activeModel.quantization || '模型包内定义'}</strong>
              </div>
              <div>
                <span>许可证</span>
                <strong>{activeModel.license || '请查看模型卡'}</strong>
              </div>
              <div>
                <span>固定版本</span>
                <strong>{activeModel.revision.slice(0, 12)}</strong>
              </div>
            </section>
            {activeJob && ['queued', 'downloading', 'paused', 'failed'].includes(activeJob.status) && (
              <section className="local-model-download-state">
                <Group justify="space-between">
                  <Text fw={600}>
                    {activeJob.status === 'paused' ? '已暂停' : activeJob.status === 'failed' ? '下载失败' : '正在下载'}
                  </Text>
                  <Text size="sm">{progress.toFixed(1)}%</Text>
                </Group>
                <Progress value={progress} color="pink" radius="xl" animated={activeJob.status === 'downloading'} />
                <Text size="xs" c="dimmed">
                  {formatBytes(activeJob.bytesDownloaded)} / {formatBytes(activeJob.bytesTotal)}
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
                    暂停
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
                    继续
                  </Button>
                )}
              </section>
            )}
            {activeJob?.status === 'completed' ? (
              <Group grow>
                {artifact?.format !== 'tflite' && (
                  <Button
                    radius="xl"
                    color="pink"
                    leftSection={<IconCheck size={18} />}
                    onClick={() => void setAsDefault()}
                  >
                    设为聊天模型
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
                  删除
                </Button>
              </Group>
            ) : (
              <Button
                radius="xl"
                color="pink"
                size="md"
                leftSection={<IconDownload size={19} />}
                disabled={
                  !artifact || artifactGroup.length === 0 || report?.status === 'unsupported' || Boolean(activeJob)
                }
                onClick={() => void startDownload()}
              >
                {artifact
                  ? `下载到应用目录 · ${formatBytes(artifactGroupBytes || artifact.sizeBytes)}`
                  : '没有可验证的 GGUF / LiteRT-LM / TFLite 文件'}
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
          <Title order={1}>发现本地模型</Title>
          <Text c="dimmed">搜索可在 Android 设备上离线运行的模型。</Text>
        </div>
        <ActionIcon
          className="local-model-queue-trigger"
          size={42}
          radius="xl"
          variant="default"
          aria-label="打开下载队列"
          onClick={() => setDownloadQueueOpened(true)}
        >
          <IconDownload size={21} />
          {activeDownloadCount > 0 && (
            <span className="local-model-queue-count">{activeDownloadCount > 9 ? '9+' : activeDownloadCount}</span>
          )}
        </ActionIcon>
      </header>
      <div className="local-model-searchbar">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void search()
          }}
          leftSection={<IconSearch size={19} />}
          placeholder="搜索模型，例如 Gemma 3、Qwen 2.5"
          radius="xl"
          size="md"
        />
        <Button radius="xl" color="pink" onClick={() => void search()} loading={loading}>
          搜索
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
          { label: '全部', value: 'all' },
          { label: 'Hugging Face', value: 'huggingface' },
          { label: '魔搭社区', value: 'modelscope' },
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
                {model.source === 'huggingface' ? 'HF' : '魔搭'}
              </span>
              <span className="local-model-row-copy">
                <strong>{model.displayName || model.name}</strong>
                <small>{model.repository}</small>
                <span className="local-model-row-tags">
                  <Badge size="xs" variant="light" color="gray">
                    {formatParameters(model.parameterCount)}
                  </Badge>
                  {model.formats.slice(0, 2).map((format) => (
                    <Badge key={format} size="xs" variant="light" color={format === 'litertlm' ? 'pink' : 'gray'}>
                      {format}
                    </Badge>
                  ))}
                  {installed && (
                    <Badge size="xs" variant="light" color="green">
                      已下载
                    </Badge>
                  )}
                </span>
              </span>
              <span className="local-model-row-meta">
                <strong>{formatBytes(model.storageSizeBytes)}</strong>
                <small>
                  {model.downloads ? `${model.downloads.toLocaleString()} 次下载` : sourceLabel(model.source)}
                </small>
              </span>
            </button>
          )
        })}
        {loading && <Loader color="pink" className="local-model-loader" />}
      </div>
    </main>
  )
}
