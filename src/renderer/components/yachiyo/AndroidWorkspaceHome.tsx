import { Alert, Button, Switch, Text, Title } from '@mantine/core'
import {
  IconAlertTriangle,
  IconDeviceMobile,
  IconFolderOpen,
  IconListCheck,
  IconPlayerPlay,
  IconRefresh,
  IconShieldLock,
} from '@tabler/icons-react'
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react'
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
  return (
    <div className="yachiyo-status-row">
      <span>{label}</span>
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
          setRootDetail('点击下方按钮后才会向 Root 管理器申请授权')
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
            ? 'Shizuku 已授权'
            : permissions.shizukuRunning
              ? 'Shizuku 已连接，等待授权'
              : 'Shizuku 服务未运行'
        )
        return
      }
      setRootState(permissions.accessibility ? 'ready' : 'unavailable')
      setRootDetail(permissions.accessibility ? '无障碍服务已连接' : '无障碍服务未启用')
    } catch (reason) {
      setRootState('unavailable')
      setRootDetail(reason instanceof Error ? reason.message : String(reason))
    }
  }, [backend])

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
      setRootDetail(reason instanceof Error ? reason.message : String(reason))
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
      setError(reason instanceof Error ? reason.message : String(reason))
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
      setError(reason instanceof Error ? reason.message : String(reason))
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
            Agent 工作台
          </Title>
        </div>
      </section>

      <section className="yachiyo-status-panel" aria-label="Agent 状态">
        <StatusRow
          label={`${backend === 'root' ? 'Root' : backend === 'shizuku' ? 'Shizuku' : '无障碍'} 运行时`}
          value={
            rootState === 'idle'
              ? '尚未检测'
              : rootState === 'checking'
                ? '检测中'
                : rootState === 'ready'
                  ? '可用'
                  : '不可用'
          }
          tone={rootState === 'ready' ? 'ready' : 'neutral'}
        />
        <StatusRow
          label="工作目录"
          value={workingDirectory}
          action={
            <Button
              variant="light"
              size="compact-sm"
              loading={choosingDirectory}
              leftSection={<IconFolderOpen size={16} />}
              onClick={handleChooseDirectory}
            >
              选择
            </Button>
          }
        />
      </section>

      <AgentConfigurationPanel onBackendChange={handleBackendChange} />

      <section className="yachiyo-agent-access-panel">
        <IconShieldLock size={32} aria-hidden="true" />
        <div className="yachiyo-agent-access-copy">
          <Title order={2}>完全访问模式</Title>
          <Text c="dimmed" size="sm">
            允许 Agent 使用 Root Shell、读取界面并执行点击、滑动、输入、按键和应用启动操作。
          </Text>
        </div>
        <Switch
          size="lg"
          checked={fullAccess}
          onChange={(event) => handleFullAccessChange(event.currentTarget.checked)}
          aria-label="完全访问模式"
        />
      </section>

      {rootState !== 'ready' && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Agent 后端不可用">
          <Text size="sm">{rootDetail || '请授权所选访问后端。'}</Text>
          <Button
            mt="sm"
            size="compact-sm"
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={rootState === 'checking'}
            onClick={() => void handleAuthorizeBackend()}
          >
            {backend === 'root' ? '检测并授权 Root' : backend === 'shizuku' ? '打开或授权 Shizuku' : '去开启无障碍服务'}
          </Button>
        </Alert>
      )}
      {error && <Alert color="red">{error}</Alert>}

      <section className="yachiyo-agent-launch-panel">
        <div>
          <Title order={2}>设备 Agent</Title>
          <Text c="dimmed" size="sm">
            描述目标后，Agent 会先观察屏幕，再调用设备工具完成任务。
          </Text>
        </div>
        <Button
          className="yachiyo-primary-button"
          leftSection={<IconPlayerPlay size={18} />}
          disabled={rootState !== 'ready'}
          loading={creating}
          onClick={handleCreateTask}
        >
          新建 Agent 任务
        </Button>
      </section>
    </main>
  )
}

export function AndroidTasksWorkspace() {
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
            任务
          </Title>
        </div>
      </section>

      <AndroidScheduledTasks />
    </main>
  )
}

export function AndroidAboutWorkspace() {
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

      <section className="yachiyo-status-panel" aria-label="应用信息">
        <StatusRow label="版本" value={version ? `v${version}` : '读取中'} />
        <StatusRow label="平台" value="Android 11+" />
        <StatusRow label="许可证" value="GPL-3.0" />
        <StatusRow
          label="更新"
          value={needCheckUpdate ? '发现新版本' : '已是最新版本'}
          tone={needCheckUpdate ? 'ready' : 'neutral'}
          action={
            <Button
              size="compact-xs"
              variant="light"
              onClick={() => void platform.openLink(needCheckUpdate ? YACHIYO_LATEST_RELEASE_URL : YACHIYO_RELEASES_URL)}
            >
              查看 Releases
            </Button>
          }
        />
      </section>
    </main>
  )
}
