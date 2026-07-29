import { Alert, Button, Switch, Text, Title, UnstyledButton } from '@mantine/core'
import {
  IconAlertTriangle,
  IconDeviceMobile,
  IconExternalLink,
  IconFolderOpen,
  IconListCheck,
  IconPlayerPlay,
  IconRefresh,
  IconShieldLock,
} from '@tabler/icons-react'
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { YACHIYO_LATEST_RELEASE_URL, YACHIYO_RELEASES_URL } from '@shared/releases/yachiyo'
import useVersion from '@/hooks/useVersion'
import {
  type AgentBackend,
  getAgentBackend,
  getAgentWorkingDirectory,
  getCachedRootCapability,
  getRootCapability,
  isAgentFullAccessEnabled,
  setAgentFullAccessEnabled,
  setAgentWorkingDirectory,
} from '@/mobile/agent-broker'
import { openChatSessionAsAgent } from '@/mobile/conversation-bridge'
import platform from '@/platform'
import { yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'
import { createEmpty } from '@/stores/sessionActions'
import { AgentConfigurationPanel } from './AgentConfigurationPanel'
import { AndroidScheduledTasks } from './AndroidScheduledTasks'
import { AndroidWorkspaceDeliveryPanel } from './AndroidWorkspaceDeliveryPanel'
import { useAdaptiveControlDensity } from './useAdaptiveControlDensity'
import { YachiyoMark } from './YachiyoMark'

function StatusRow({
  label,
  value,
  tone = 'neutral',
  action,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'ready'
  action?: ReactNode
}) {
  const { containerRef, density, pointerHandlers } = useAdaptiveControlDensity<HTMLDivElement>({
    contentKey: `${label}\u001f${value}\u001f${Boolean(action)}`,
  })

  return (
    <div
      ref={containerRef}
      className="yachiyo-status-row"
      data-density={density}
      data-has-action={action ? 'true' : undefined}
      {...pointerHandlers}
    >
      <span className="yachiyo-status-label">{label}</span>
      <div className="yachiyo-status-value">
        <strong data-tone={tone} title={value}>
          {value}
        </strong>
        {action}
      </div>
    </div>
  )
}

export function AndroidAgentWorkspace() {
  const { t } = useTranslation()
  const titleId = useId()
  const [fullAccess, setFullAccess] = useState(isAgentFullAccessEnabled)
  const [backend, setBackend] = useState<AgentBackend>(getAgentBackend)
  const [rootState, setRootState] = useState<'idle' | 'checking' | 'ready' | 'unavailable'>('idle')
  const [rootDetail, setRootDetail] = useState('')
  const [creating, setCreating] = useState(false)
  const [choosingDirectory, setChoosingDirectory] = useState(false)
  const [workingDirectory, setWorkingDirectory] = useState(getAgentWorkingDirectory)
  const [error, setError] = useState('')

  const refreshBackend = useCallback(async () => {
    try {
      if (backend === 'root') {
        const cached = getCachedRootCapability()
        if (!cached) {
          setRootState('idle')
          setRootDetail(String(t('点击下方按钮后才会向 Root 管理器申请授权')))
          return
        }
        setRootState(cached.available ? 'ready' : 'unavailable')
        setRootDetail(cached.detail)
        return
      }

      const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
      if (backend === 'shizuku') {
        setRootState(permissions.shizukuGranted ? 'ready' : 'unavailable')
        setRootDetail(
          permissions.shizukuGranted
            ? String(t('Shizuku 已授权'))
            : permissions.shizukuRunning
              ? String(t('Shizuku 已连接，等待授权'))
              : String(t('Shizuku 服务未运行'))
        )
        return
      }
      setRootState(permissions.accessibility ? 'ready' : 'unavailable')
      setRootDetail(permissions.accessibility ? String(t('无障碍服务已连接')) : String(t('无障碍服务未启用')))
    } catch (reason) {
      setRootState('unavailable')
      setRootDetail(String(t(reason instanceof Error ? reason.message : String(reason))))
    }
  }, [backend, t])

  useEffect(() => {
    void refreshBackend()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshBackend()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timer =
      backend === 'root'
        ? undefined
        : window.setInterval(() => {
            if (document.visibilityState === 'visible') void refreshBackend()
          }, 1_500)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer) window.clearInterval(timer)
    }
  }, [backend, refreshBackend])

  const handleAuthorizeBackend = async () => {
    setRootState('checking')
    setError('')
    try {
      if (backend === 'root') {
        const root = await getRootCapability()
        setRootState(root.available ? 'ready' : 'unavailable')
        setRootDetail(root.detail)
        return
      }

      if (backend === 'shizuku') {
        const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
        if (permissions.shizukuRunning) {
          await yachiyoDeviceAccessNative.requestShizukuPermission()
          await refreshBackend()
        } else {
          await yachiyoDeviceAccessNative.openPermissionSettings('shizuku')
          setRootState('unavailable')
        }
        return
      }

      await yachiyoDeviceAccessNative.openPermissionSettings('accessibility')
      setRootState('unavailable')
    } catch (reason) {
      setRootState('unavailable')
      setRootDetail(String(t(reason instanceof Error ? reason.message : String(reason))))
    }
  }

  const handleFullAccessChange = (enabled: boolean) => {
    setAgentFullAccessEnabled(enabled)
    setFullAccess(enabled)
    setError('')
  }

  const handleBackendChange = (nextBackend: AgentBackend) => {
    setBackend(nextBackend)
    setRootDetail('')
    setRootState(nextBackend === 'root' && !getCachedRootCapability() ? 'idle' : 'checking')
  }

  const handleCreateTask = async () => {
    setCreating(true)
    setError('')
    try {
      setAgentWorkingDirectory(workingDirectory)
      const session = await createEmpty('chat')
      await openChatSessionAsAgent(session.id)
    } catch (reason) {
      setError(String(t(reason instanceof Error ? reason.message : String(reason))))
    } finally {
      setCreating(false)
    }
  }

  const handleChooseDirectory = async () => {
    setChoosingDirectory(true)
    setError('')
    try {
      const result = await platform.openDirectoryDialog?.()
      if (result?.path) {
        setAgentWorkingDirectory(result.path)
        setWorkingDirectory(result.path)
      }
    } catch (reason) {
      setError(String(t(reason instanceof Error ? reason.message : String(reason))))
    } finally {
      setChoosingDirectory(false)
    }
  }

  return (
    <main className="yachiyo-workspace" aria-labelledby={titleId}>
      <section className="yachiyo-workspace-heading">
        <div className="yachiyo-workspace-icon">
          <IconDeviceMobile size={28} aria-hidden="true" />
        </div>
        <div>
          <Text className="yachiyo-eyebrow">DEVICE AGENT</Text>
          <Title id={titleId} order={1}>
            {t('Agent 工作台')}
          </Title>
        </div>
      </section>

      <section className="yachiyo-status-panel" aria-label={String(t('Agent 状态'))}>
        <StatusRow
          label={t('{{backend}} 运行时', {
            backend: backend === 'root' ? 'Root' : backend === 'shizuku' ? 'Shizuku' : t('无障碍'),
          })}
          value={
            rootState === 'idle'
              ? t('尚未检测')
              : rootState === 'checking'
                ? t('检测中')
                : rootState === 'ready'
                  ? t('可用')
                  : t('不可用')
          }
          tone={rootState === 'ready' ? 'ready' : 'neutral'}
        />
        <StatusRow
          label={t('工作目录')}
          value={workingDirectory}
          action={
            <Button
              variant="light"
              size="compact-sm"
              loading={choosingDirectory}
              leftSection={<IconFolderOpen size={16} />}
              onClick={handleChooseDirectory}
            >
              {t('选择')}
            </Button>
          }
        />
      </section>

      <AgentConfigurationPanel onBackendChange={handleBackendChange} />

      <AndroidWorkspaceDeliveryPanel />

      <section className="yachiyo-agent-access-panel">
        <IconShieldLock size={32} aria-hidden="true" />
        <div className="yachiyo-agent-access-copy">
          <Title order={2}>{t('完全访问模式')}</Title>
          <Text c="dimmed" size="sm">
            {t('允许 Agent 使用 Root Shell、读取界面并执行点击、滑动、输入、按键和应用启动操作。')}
          </Text>
        </div>
        <Switch
          size="lg"
          checked={fullAccess}
          onChange={(event) => handleFullAccessChange(event.currentTarget.checked)}
          aria-label={String(t('完全访问模式'))}
        />
      </section>

      {rootState !== 'ready' && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title={t('Agent 后端不可用')}>
          <Text size="sm">{rootDetail || t('请授权所选访问后端。')}</Text>
          <Button
            mt="sm"
            size="compact-sm"
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={rootState === 'checking'}
            onClick={() => void handleAuthorizeBackend()}
          >
            {backend === 'root'
              ? t('检测并授权 Root')
              : backend === 'shizuku'
                ? t('打开或授权 Shizuku')
                : t('去开启无障碍服务')}
          </Button>
        </Alert>
      )}
      {error && <Alert color="red">{error}</Alert>}

      <section className="yachiyo-agent-launch-panel">
        <div>
          <Title order={2}>{t('设备 Agent')}</Title>
          <Text c="dimmed" size="sm">
            {t('描述目标后，Agent 会先观察屏幕，再调用设备工具完成任务。')}
          </Text>
        </div>
        <Button
          className="yachiyo-primary-button"
          leftSection={<IconPlayerPlay size={18} />}
          disabled={rootState !== 'ready'}
          loading={creating}
          onClick={handleCreateTask}
        >
          {t('新建 Agent 任务')}
        </Button>
      </section>
    </main>
  )
}

export function AndroidTasksWorkspace() {
  const { t } = useTranslation()
  const titleId = useId()

  return (
    <main className="yachiyo-workspace" aria-labelledby={titleId}>
      <section className="yachiyo-workspace-heading">
        <div className="yachiyo-workspace-icon yachiyo-workspace-icon-amber">
          <IconListCheck size={28} aria-hidden="true" />
        </div>
        <div>
          <Text className="yachiyo-eyebrow">AUTOMATIONS</Text>
          <Title id={titleId} order={1}>
            {t('任务')}
          </Title>
        </div>
      </section>

      <AndroidScheduledTasks />
    </main>
  )
}

export function AndroidAboutWorkspace() {
  const { t } = useTranslation()
  const titleId = useId()
  const { version, needCheckUpdate } = useVersion()

  return (
    <main className="yachiyo-workspace" aria-labelledby={titleId}>
      <section className="yachiyo-about-brand">
        <YachiyoMark size={72} />
        <div>
          <Text className="yachiyo-eyebrow">OPEN SOURCE · ANDROID</Text>
          <Title id={titleId} order={1}>
            Yachiyo Claw
          </Title>
          <Text c="dimmed">AI chat and device agent</Text>
        </div>
      </section>

      <section className="yachiyo-status-panel" aria-label={String(t('应用信息'))}>
        <StatusRow label={t('版本')} value={version ? `v${version}` : t('读取中')} />
        <StatusRow label={t('平台')} value="Android 11+" />
        <StatusRow label={t('许可证')} value="GPL-3.0" />
        <StatusRow
          label={t('更新')}
          value={needCheckUpdate ? t('发现新版本') : t('已是最新版本')}
          tone={needCheckUpdate ? 'ready' : 'neutral'}
          action={
            <UnstyledButton
              className="yachiyo-about-release-action"
              type="button"
              aria-label={String(t('查看 Releases'))}
              onClick={() =>
                void platform.openLink(needCheckUpdate ? YACHIYO_LATEST_RELEASE_URL : YACHIYO_RELEASES_URL)
              }
            >
              {t('查看 Releases')}
              <IconExternalLink size={14} stroke={1.8} aria-hidden="true" />
            </UnstyledButton>
          }
        />
      </section>
    </main>
  )
}
