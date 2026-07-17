import { Badge, Button, Flex, Loader, Stack, Text, Title } from '@mantine/core'
import { IconCheck, IconExternalLink, IconShieldCheck, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { getCachedRootCapability, getRootCapability } from '@/mobile/agent-broker'
import { shouldOpenPermissionWizard } from '@/mobile/device-permissions'
import {
  type DevicePermissionStatus,
  type PermissionTarget,
  yachiyoDeviceAccessNative,
} from '@/platform/native/yachiyo_device_access'

interface PermissionRowProps {
  label: string
  description: string
  granted: boolean
  optional?: boolean
  actionLabel?: string
  onAction?: () => void
  actionLoading?: boolean
}

function PermissionRow({
  label,
  description,
  granted,
  optional,
  actionLabel = '去设置',
  onAction,
  actionLoading,
}: PermissionRowProps) {
  return (
    <Flex className="yachiyo-permission-row" align="center" gap="sm">
      <div className="yachiyo-permission-status" data-granted={granted}>
        {granted ? <IconCheck size={16} /> : <IconX size={16} />}
      </div>
      <div className="yachiyo-permission-copy">
        <Flex align="center" gap={6}>
          <Text fw={600} size="sm">
            {label}
          </Text>
          {optional && (
            <Badge size="xs" color="gray" variant="light">
              可选
            </Badge>
          )}
        </Flex>
        <Text c="dimmed" size="xs">
          {description}
        </Text>
      </div>
      {!granted && onAction && (
        <Button
          size="compact-sm"
          variant="light"
          loading={actionLoading}
          rightSection={<IconExternalLink size={14} />}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </Flex>
  )
}

export function AndroidPermissionWizard() {
  const [status, setStatus] = useState<DevicePermissionStatus | null>(null)
  const [rootCapability, setRootCapability] = useState(getCachedRootCapability)
  const [rootChecking, setRootChecking] = useState(false)
  const [opened, setOpened] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deferred, setDeferred] = useState(
    () => sessionStorage.getItem('yachiyo-permission-wizard-deferred') === 'true'
  )

  const refresh = useCallback(async () => {
    try {
      const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
      setStatus(permissions)
      const cachedRoot = getCachedRootCapability()
      setRootCapability(cachedRoot)
      if (shouldOpenPermissionWizard(permissions, Boolean(cachedRoot?.available), deferred)) {
        setOpened(true)
      }
    } finally {
      setLoading(false)
    }
  }, [deferred])

  useEffect(() => {
    void refresh()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(() => {
      if (opened) void refresh()
    }, 1_500)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
    }
  }, [opened, refresh])

  const requiredReady = useMemo(() => {
    if (!status) return false
    return (
      status.overlay &&
      status.batteryOptimizationIgnored &&
      (rootCapability?.available || status.shizukuGranted || status.accessibility)
    )
  }, [rootCapability?.available, status])

  const openSettings = (target: PermissionTarget) => {
    void yachiyoDeviceAccessNative.openPermissionSettings(target)
  }

  const checkRoot = async () => {
    setRootChecking(true)
    try {
      setRootCapability(await getRootCapability())
    } catch (reason) {
      setRootCapability({ available: false, detail: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setRootChecking(false)
    }
  }

  const deferWizard = () => {
    sessionStorage.setItem('yachiyo-permission-wizard-deferred', 'true')
    setDeferred(true)
    setOpened(false)
  }

  const completeWizard = () => {
    sessionStorage.removeItem('yachiyo-permission-wizard-deferred')
    setDeferred(false)
    setOpened(false)
  }

  return (
    <AdaptiveModal opened={opened} onClose={deferWizard} title="Agent 权限设置" centered size="lg">
      <Stack gap="md">
        <Flex align="center" gap="sm">
          <div className="yachiyo-permission-hero">
            <IconShieldCheck size={26} />
          </div>
          <div>
            <Title order={3} size="h4">
              让 Yachiyo Claw 可以持续操作设备
            </Title>
            <Text c="dimmed" size="sm">
              必选权限未完成时，本向导会在下次启动时再次出现。
            </Text>
          </div>
        </Flex>

        {loading || !status ? (
          <Flex justify="center" py="xl">
            <Loader size="sm" />
          </Flex>
        ) : (
          <Stack gap={0} className="yachiyo-permission-list">
            <PermissionRow
              label="悬浮窗"
              description="显示屏幕边缘光晕、操作状态和停止按钮。"
              granted={status.overlay}
              onAction={() => openSettings('overlay')}
            />
            <PermissionRow
              label="忽略电池优化"
              description="避免长时间 Agent 任务在后台被系统中断。"
              granted={status.batteryOptimizationIgnored}
              onAction={() => openSettings('battery')}
            />
            <PermissionRow
              label="Root"
              description={
                rootCapability?.detail
                  ? `Magisk、KernelSU、APatch 或原生 Root Shell。${rootCapability.detail}`
                  : '支持 Magisk、KernelSU、APatch 和原生 Root；仅在点击检测时申请授权。'
              }
              granted={Boolean(rootCapability?.available)}
              actionLabel={rootCapability ? '重新检测' : '检测并授权'}
              actionLoading={rootChecking}
              onAction={() => void checkRoot()}
            />
            <PermissionRow
              label="Shizuku"
              description="无需 Root 的 ADB 级 Shell 后端。"
              granted={status.shizukuGranted}
              actionLabel={status.shizukuRunning ? '授权' : '打开'}
              onAction={() =>
                status.shizukuRunning
                  ? void yachiyoDeviceAccessNative.requestShizukuPermission().then(refresh)
                  : openSettings('shizuku')
              }
            />
            <PermissionRow
              label="无障碍服务"
              description="观察界面并执行点击、滑动、输入和系统导航。"
              granted={status.accessibility}
              onAction={() => openSettings('accessibility')}
            />
            <PermissionRow
              label="所有文件访问"
              description="让 Agent 处理所选工作区之外的共享存储文件。"
              granted={status.allFiles}
              optional
              onAction={() => openSettings('storage')}
            />
          </Stack>
        )}

        <AdaptiveModal.Actions>
          <Button variant="subtle" color="gray" onClick={deferWizard}>
            稍后处理
          </Button>
          <Button disabled={!requiredReady} onClick={completeWizard}>
            完成
          </Button>
        </AdaptiveModal.Actions>
      </Stack>
    </AdaptiveModal>
  )
}
