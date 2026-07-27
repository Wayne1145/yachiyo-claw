import { Badge, Button, Flex, Loader, Stack, Text, Title } from '@mantine/core'
import { IconCheck, IconExternalLink, IconShieldCheck, IconX } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { getNativeFeatureHealth, type NativeFeatureHealth } from '@/features/native-health'
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
  statusUnknown?: boolean
}

function PermissionRow({
  label,
  description,
  granted,
  optional,
  actionLabel,
  onAction,
  actionLoading,
  statusUnknown,
}: PermissionRowProps) {
  const { t } = useTranslation()

  return (
    <Flex className="yachiyo-permission-row" align="center" gap="sm">
      <div className="yachiyo-permission-status" data-granted={statusUnknown ? undefined : granted}>
        {statusUnknown ? <IconExternalLink size={16} /> : granted ? <IconCheck size={16} /> : <IconX size={16} />}
      </div>
      <div className="yachiyo-permission-copy">
        <Flex className="yachiyo-permission-label-line" align="center" gap={6} wrap="wrap">
          <Text fw={600} size="sm">
            {label}
          </Text>
          {optional && (
            <Badge size="xs" color="gray" variant="light">
              {t('可选')}
            </Badge>
          )}
        </Flex>
        <Text c="dimmed" size="xs">
          {description}
        </Text>
      </div>
      {(!granted || statusUnknown) && onAction && (
        <Button
          className="yachiyo-permission-action"
          size="compact-sm"
          variant="light"
          loading={actionLoading}
          rightSection={<IconExternalLink size={14} />}
          onClick={onAction}
        >
          {actionLabel || t('去设置')}
        </Button>
      )}
    </Flex>
  )
}

export function AndroidPermissionWizard() {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<DevicePermissionStatus | null>(null)
  const [opened, setOpened] = useState(false)
  const [nativeHealth, setNativeHealth] = useState<readonly NativeFeatureHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [deferred, setDeferred] = useState(
    () => sessionStorage.getItem('yachiyo-permission-wizard-deferred') === 'true'
  )

  const refresh = useCallback(async () => {
    try {
      const permissions = await yachiyoDeviceAccessNative.getPermissionStatus()
      const health = getNativeFeatureHealth()
      setStatus(permissions)
      setNativeHealth(health)
      if (health.some((item) => !item.available) || shouldOpenPermissionWizard(permissions, deferred)) {
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
      status.batteryOptimizationIgnored && status.notificationsGranted && nativeHealth.every((item) => item.available)
    )
  }, [nativeHealth, status])

  const openSettings = (target: PermissionTarget) => {
    void yachiyoDeviceAccessNative.openPermissionSettings(target)
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
    <AdaptiveModal opened={opened} onClose={deferWizard} title={t('基础权限设置')} centered size="lg">
      <Stack gap="md">
        <Flex align="center" gap="sm">
          <div className="yachiyo-permission-hero">
            <IconShieldCheck size={26} />
          </div>
          <div>
            <Title order={3} size="h4">
              {t('让 Yachiyo Claw 可以稳定运行')}
            </Title>
            <Text c="dimmed" size="sm">
              {t('必选权限未完成时，本向导会在下次启动时再次出现。')}
            </Text>
          </div>
        </Flex>

        {loading || !status ? (
          <Flex justify="center" py="xl">
            <Loader size="sm" />
          </Flex>
        ) : (
          <Stack gap={0} className="yachiyo-permission-list">
            {nativeHealth
              .filter((item) => !item.available)
              .map((item) => (
                <PermissionRow
                  key={item.featureId}
                  label={t('{{feature}} 原生组件', { feature: item.featureId })}
                  description={t('当前安装包缺少 {{plugins}}，请安装完整版本。', {
                    plugins: new Intl.ListFormat(i18n.resolvedLanguage || i18n.language, {
                      style: 'short',
                      type: 'conjunction',
                    }).format([...item.missingPlugins]),
                  })}
                  granted={false}
                />
              ))}
            <PermissionRow
              label={t('任务通知')}
              description={t('显示定时任务唤醒和待继续状态；通知不包含提示词、密钥或执行结果。')}
              granted={status.notificationsGranted}
              onAction={() => openSettings('notifications')}
            />
            <PermissionRow
              label={t('忽略电池优化')}
              description={t('避免长时间 Agent 任务在后台被系统中断。')}
              granted={status.batteryOptimizationIgnored}
              onAction={() => openSettings('battery')}
            />
            {status.autoStartSettingsAvailable && (
              <PermissionRow
                label={t('厂商自启动管理')}
                description={t('{{device}} 的授权状态无法被应用可靠读取，请确认允许自启动和后台运行。', {
                  device: status.deviceManufacturer || t('当前设备'),
                })}
                granted={false}
                optional
                statusUnknown
                actionLabel={String(t('去确认'))}
                onAction={() => openSettings('autostart')}
              />
            )}
            <PermissionRow
              label={t('所有文件访问')}
              description={t('让 Agent 处理所选工作区之外的共享存储文件。')}
              granted={status.allFiles}
              optional
              onAction={() => openSettings('storage')}
            />
          </Stack>
        )}

        <AdaptiveModal.Actions>
          <Button variant="subtle" color="gray" onClick={deferWizard}>
            {t('稍后处理')}
          </Button>
          <Button disabled={!requiredReady} onClick={completeWizard}>
            {t('完成')}
          </Button>
        </AdaptiveModal.Actions>
      </Stack>
    </AdaptiveModal>
  )
}
