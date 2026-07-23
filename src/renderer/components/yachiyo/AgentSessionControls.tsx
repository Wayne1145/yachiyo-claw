import { Alert, Button, SegmentedControl, Stack, Switch, Text, Title } from '@mantine/core'
import { IconAdjustments, IconAlertTriangle, IconBolt, IconShieldLock } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import {
  type AgentBackend,
  getAgentBackend,
  getCachedRootCapability,
  getRootCapability,
  setAgentFullAccessEnabled,
  setAgentBackend,
} from '@/mobile/agent-broker'
import { type AgentApprovalMode, getAgentSessionConfig, saveAgentSessionConfig } from '@/mobile/agent-session-config'
import { getAgentRuntimeSettings, saveAgentRuntimeSettings } from '@/mobile/agent-runtime-settings'
import { AgentConfigurationPanel } from './AgentConfigurationPanel'
import { type DevicePermissionStatus, yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'

const APPROVAL_OPTIONS = [
  { value: 'manual', label: '手动审批' },
  { value: 'smart', label: 'AI 预审' },
  { value: 'full', label: '完全控制' },
]

const APPROVAL_LABEL: Record<AgentApprovalMode, string> = {
  manual: '手动审批',
  smart: 'AI 预审',
  full: '完全控制',
}

export function describeAgentMode(sessionId: string, enabled: boolean): string {
  if (!enabled) return '普通聊天'
  const config = getAgentSessionConfig(sessionId)
  if (!config.deviceControlEnabled) return `Agent · 内部工具 · ${APPROVAL_LABEL[config.approvalMode]}`
  const backend = config.backend === 'accessibility' ? '无障碍' : config.backend === 'shizuku' ? 'Shizuku' : 'Root'
  return `Agent · 手机控制 ${backend} · ${APPROVAL_LABEL[config.approvalMode]}`
}

export function AgentSessionControls({
  sessionId,
  enabled,
  onToggle,
}: {
  sessionId: string
  enabled: boolean
  onToggle: (enabled: boolean) => Promise<void>
}) {
  const [config, setConfig] = useState(() => getAgentSessionConfig(sessionId))
  const [settingsOpened, setSettingsOpened] = useState(false)
  const [phonePermissionOpened, setPhonePermissionOpened] = useState(false)
  const [fullWarningOpened, setFullWarningOpened] = useState(false)
  const [pendingEnable, setPendingEnable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [approvalMode, setApprovalMode] = useState<AgentApprovalMode>(config.approvalMode)
  const [backend, setBackend] = useState<AgentBackend>(config.backend)
  const [deviceControlEnabled, setDeviceControlEnabled] = useState(config.deviceControlEnabled)
  const [permissionStatus, setPermissionStatus] = useState<DevicePermissionStatus | null>(null)
  const [backendReady, setBackendReady] = useState(false)
  const [backendDetail, setBackendDetail] = useState('')
  const [authorizing, setAuthorizing] = useState(false)
  const [returnToApp, setReturnToApp] = useState(() => getAgentRuntimeSettings().returnToAppOnComplete)

  useEffect(() => {
    const next = getAgentSessionConfig(sessionId)
    setConfig(next)
    setApprovalMode(next.approvalMode)
    setBackend(next.backend)
    setDeviceControlEnabled(next.deviceControlEnabled)
  }, [sessionId, enabled])

  const refreshBackend = async (selected = backend) => {
    if (selected === 'root') {
      const root = getCachedRootCapability()
      setBackendReady(Boolean(root?.available))
      setBackendDetail(root?.detail || '尚未检测 Root 授权')
      return
    }
    const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
    setPermissionStatus(permissions)
    if (selected === 'shizuku') {
      setBackendReady(permissions.shizukuGranted)
      setBackendDetail(
        permissions.shizukuGranted
          ? 'Shizuku 已授权'
          : permissions.shizukuRunning
            ? '等待 Shizuku 授权'
            : 'Shizuku 服务未运行',
      )
    } else {
      setBackendReady(permissions.accessibility)
      setBackendDetail(permissions.accessibility ? '无障碍服务已连接' : '无障碍服务尚未启用')
    }
  }

  useEffect(() => {
    if (settingsOpened || phonePermissionOpened) void refreshBackend()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpened, phonePermissionOpened, backend])

  useEffect(() => {
    if (!settingsOpened && !phonePermissionOpened) return
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshBackend()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpened, phonePermissionOpened, backend])

  const status = useMemo(() => describeAgentMode(sessionId, enabled), [sessionId, enabled, config])

  const openSettings = (enableAfterSave = false) => {
    setPendingEnable(enableAfterSave)
    setSettingsOpened(true)
  }

  const toggle = async () => {
    if (enabled) {
      const next = saveAgentSessionConfig(sessionId, { enabled: false, allowDangerousForConversation: false })
      setConfig(next)
      await onToggle(false)
      return
    }
    if (!config.configured) {
      openSettings(true)
      return
    }
    const next = saveAgentSessionConfig(sessionId, { enabled: true })
    setConfig(next)
    await onToggle(true)
  }

  const selectApprovalMode = (value: string) => {
    const next = value as AgentApprovalMode
    if (next === 'full') {
      setFullWarningOpened(true)
      return
    }
    setApprovalMode(next)
  }

  const save = async () => {
    setSaving(true)
    try {
      setAgentFullAccessEnabled(deviceControlEnabled)
      const next = saveAgentSessionConfig(sessionId, {
        backend,
        deviceControlEnabled,
        approvalMode,
        configured: true,
        enabled: pendingEnable || enabled,
        allowDangerousForConversation: false,
      })
      setConfig(next)
      setSettingsOpened(false)
      if (pendingEnable) await onToggle(true)
      setPendingEnable(false)
    } finally {
      setSaving(false)
    }
  }

  const authorizeBackend = async () => {
    setAuthorizing(true)
    try {
      if (backend === 'root') {
        await getRootCapability()
      } else if (backend === 'shizuku') {
        const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
        if (permissions.shizukuRunning) await yachiyoDeviceAccessNative.requestShizukuPermission()
        else await yachiyoDeviceAccessNative.openPermissionSettings('shizuku')
      } else {
        await yachiyoDeviceAccessNative.openPermissionSettings('accessibility')
      }
      await refreshBackend()
    } finally {
      setAuthorizing(false)
    }
  }

  const changePhoneBackend = (value: string) => {
    const next = value as AgentBackend
    setBackend(next)
    setAgentBackend(next)
    setBackendReady(false)
    void refreshBackend(next)
  }

  const phonePermissionsReady = Boolean(permissionStatus?.overlay && backendReady)

  return (
    <>
      <div className="yachiyo-agent-header-controls" data-enabled={enabled ? 'true' : 'false'}>
        <Button
          className="yachiyo-agent-toggle"
          variant={enabled ? 'filled' : 'outline'}
          color={enabled ? undefined : 'gray'}
          aria-pressed={enabled}
          leftSection={<IconBolt size={17} />}
          onClick={() => void toggle()}
        >
          {enabled ? 'Agent 已启用' : 'Agent 能力未启用'}
        </Button>
        <Button
          className="yachiyo-agent-settings-button"
          variant="default"
          leftSection={<IconAdjustments size={17} />}
          onClick={() => openSettings(false)}
        >
          Agent 设置
        </Button>
        <Text size="xs" c="dimmed" className="yachiyo-agent-mode-label">
          {status}
        </Text>
      </div>

      <AdaptiveModal
        opened={settingsOpened}
        onClose={() => {
          setSettingsOpened(false)
          setPendingEnable(false)
        }}
        title="当前对话的 Agent 设置"
        centered
        size="lg"
      >
        <Stack gap="md">
          <AgentConfigurationPanel showAccessBackend={false} />
          <section className="yachiyo-agent-config-panel">
            <Switch
              size="md"
              label="手机控制"
              description="可选。开启后才允许 Agent 通过 Root、Shizuku 或无障碍观察和操作手机。"
              checked={deviceControlEnabled}
              onChange={(event) => {
                const checked = event.currentTarget.checked
                setDeviceControlEnabled(checked)
                if (checked) {
                  setPhonePermissionOpened(true)
                  void refreshBackend()
                }
              }}
            />
            {deviceControlEnabled && (
              <Button variant="light" onClick={() => setPhonePermissionOpened(true)}>
                手机控制权限与后端
              </Button>
            )}
          </section>
          <section className="yachiyo-agent-config-panel">
            <div>
              <Title order={2}>执行审批</Title>
              <Text c="dimmed" size="sm">
                手动审批会确认每次写操作；AI 预审只将高风险操作交给你；完全控制不会询问。
              </Text>
            </div>
            <SegmentedControl fullWidth value={approvalMode} onChange={selectApprovalMode} data={APPROVAL_OPTIONS} />
            {deviceControlEnabled && (
              <Switch
                label="任务完成后自动返回 Yachiyo Claw"
                description="Agent 在其他应用操作完成后，将 Yachiyo Claw 重新切换到前台。"
                checked={returnToApp}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  setReturnToApp(checked)
                  saveAgentRuntimeSettings({ returnToAppOnComplete: checked })
                }}
              />
            )}
          </section>
          {config.allowDangerousForConversation && (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="当前对话已跳过后续审批">
              <Button
                mt="xs"
                size="compact-sm"
                variant="light"
                onClick={() => setConfig(saveAgentSessionConfig(sessionId, { allowDangerousForConversation: false }))}
              >
                恢复审批
              </Button>
            </Alert>
          )}
          <AdaptiveModal.Actions>
            <Button variant="default" onClick={() => setSettingsOpened(false)}>
              取消
            </Button>
            <Button
              loading={saving}
              disabled={deviceControlEnabled && !phonePermissionsReady}
              onClick={() => void save()}
            >
              保存设置
            </Button>
          </AdaptiveModal.Actions>
        </Stack>
      </AdaptiveModal>

      <AdaptiveModal
        opened={phonePermissionOpened}
        onClose={() => setPhonePermissionOpened(false)}
        title="手机控制权限"
        centered
        size="lg"
      >
        <Stack gap="md">
          <Alert color="pink" title="此权限仅用于操作手机">
            内部 Linux 沙箱、Skills、MCP 和文件工具不需要 Root、Shizuku 或无障碍权限。
          </Alert>
          <section className="yachiyo-agent-config-panel">
            <Title order={2}>控制方式</Title>
            <SegmentedControl
              fullWidth
              value={backend}
              onChange={changePhoneBackend}
              data={[
                { value: 'root', label: 'Root' },
                { value: 'shizuku', label: 'Shizuku' },
                { value: 'accessibility', label: '无障碍' },
              ]}
            />
            <Text size="sm" c={backendReady ? 'green' : 'orange'}>
              {backendDetail || '正在检测所选控制方式'}
            </Text>
            {!backendReady && (
              <Button variant="light" loading={authorizing} onClick={() => void authorizeBackend()}>
                {backend === 'root'
                  ? '检测并授权 Root'
                  : backend === 'shizuku'
                    ? '打开或授权 Shizuku'
                    : '去开启无障碍服务'}
              </Button>
            )}
          </section>
          <section className="yachiyo-agent-config-panel">
            <Title order={2}>操作状态悬浮窗</Title>
            <Text size="sm" c={permissionStatus?.overlay ? 'green' : 'orange'}>
              {permissionStatus?.overlay ? '已授权' : '未授权：用于显示操作光晕、流式状态、停止与审批入口。'}
            </Text>
            {!permissionStatus?.overlay && (
              <Button variant="light" onClick={() => void yachiyoDeviceAccessNative.openPermissionSettings('overlay')}>
                去授权悬浮窗
              </Button>
            )}
          </section>
          <AdaptiveModal.Actions>
            <Button variant="default" onClick={() => setPhonePermissionOpened(false)}>
              稍后处理
            </Button>
            <Button disabled={!phonePermissionsReady} onClick={() => setPhonePermissionOpened(false)}>
              权限已就绪
            </Button>
          </AdaptiveModal.Actions>
        </Stack>
      </AdaptiveModal>

      <AdaptiveModal
        opened={fullWarningOpened}
        onClose={() => setFullWarningOpened(false)}
        title="启用完全控制？"
        centered
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" icon={<IconShieldLock size={20} />} title="该模式风险很高">
            Agent 可以直接执行 Root/Shizuku 命令、操作其他应用并修改或删除数据，不再逐次询问。
          </Alert>
          <AdaptiveModal.Actions>
            <Button variant="default" onClick={() => setFullWarningOpened(false)}>
              保持审批
            </Button>
            <Button
              color="red"
              onClick={() => {
                setApprovalMode('full')
                setFullWarningOpened(false)
              }}
            >
              我了解风险，继续
            </Button>
          </AdaptiveModal.Actions>
        </Stack>
      </AdaptiveModal>
    </>
  )
}
