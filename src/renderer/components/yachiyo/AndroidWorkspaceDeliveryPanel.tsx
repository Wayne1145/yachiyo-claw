import { ActionIcon, Alert, Button, Paper, Stack, Text, Title, Tooltip } from '@mantine/core'
import { IconDownload, IconFolderOpen, IconRefresh, IconShare, IconUpload } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import platform from '@/platform'
import { AdaptiveActionCluster, type AdaptiveActionDescriptor } from './AdaptiveActionCluster'

type WorkspaceState = Awaited<ReturnType<NonNullable<typeof platform.externalWorkspaceStatus>>>

export function AndroidWorkspaceDeliveryPanel() {
  const { t } = useTranslation()
  const [workspace, setWorkspace] = useState<WorkspaceState>({ available: false })
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => {
    if (!platform.externalWorkspaceStatus) return
    setWorkspace(await platform.externalWorkspaceStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name)
    setMessage('')
    try {
      const result = await action()
      if (
        result &&
        typeof result === 'object' &&
        'success' in result &&
        (result as { success?: unknown }).success === false
      ) {
        throw new Error(String((result as { error?: unknown }).error || 'workspace_operation_failed'))
      }
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const choose = () =>
    run('choose', async () => {
      if (!platform.pickExternalWorkspace || !platform.syncExternalWorkspace)
        throw new Error('external_workspace_unavailable')
      const selected = await platform.pickExternalWorkspace()
      if (selected.canceled || !selected.workspaceKey) return
      const imported = await platform.syncExternalWorkspace('in')
      if (!imported.success) throw new Error(imported.error || 'workspace_sync_in_failed')
      const initialized = await platform.sandboxInit?.({ workingDirectory: selected.workspaceKey })
      if (initialized && !initialized.success) throw new Error(initialized.error || 'sandbox_init_failed')
    })

  const createWorkspaceAction = ({
    id,
    label,
    Icon,
    priority,
    group,
    busyKey,
    onSelect,
  }: {
    id: string
    label: string
    Icon: typeof IconDownload
    priority: number
    group: string
    busyKey: string
    onSelect: () => void
  }): AdaptiveActionDescriptor => ({
    id,
    label,
    icon: Icon,
    priority,
    group,
    collapseStrategy: 'icon-then-overflow',
    disabled: !workspace.available,
    renderControl: ({ presentation }) =>
      presentation === 'labelled' ? (
        <Button
          variant="light"
          leftSection={<Icon size={16} />}
          disabled={!workspace.available}
          loading={busy === busyKey}
          onClick={onSelect}
        >
          {label}
        </Button>
      ) : (
        <Tooltip label={label}>
          <ActionIcon
            size={44}
            variant="light"
            disabled={!workspace.available}
            loading={busy === busyKey}
            aria-label={label}
            onClick={onSelect}
          >
            <Icon size={18} />
          </ActionIcon>
        </Tooltip>
      ),
    menuAction: { disabled: !workspace.available, onSelect },
  })

  const actions: AdaptiveActionDescriptor[] = [
    {
      id: 'choose',
      label: String(t('选择并导入')),
      icon: IconFolderOpen,
      priority: 100,
      group: 'primary',
      collapseStrategy: 'keep',
      renderControl: () => (
        <Button
          variant="light"
          leftSection={<IconFolderOpen size={16} />}
          loading={busy === 'choose'}
          onClick={() => void choose()}
        >
          {t('选择并导入')}
        </Button>
      ),
    },
    createWorkspaceAction({
      id: 'import',
      label: String(t('重新导入')),
      Icon: IconDownload,
      priority: 80,
      group: 'sync',
      busyKey: 'in',
      onSelect: () => void run('in', async () => platform.syncExternalWorkspace?.('in')),
    }),
    createWorkspaceAction({
      id: 'write-back',
      label: String(t('写回目录')),
      Icon: IconUpload,
      priority: 70,
      group: 'sync',
      busyKey: 'out',
      onSelect: () => void run('out', async () => platform.syncExternalWorkspace?.('out')),
    }),
    createWorkspaceAction({
      id: 'export',
      label: String(t('导出 ZIP')),
      Icon: IconShare,
      priority: 50,
      group: 'delivery',
      busyKey: 'export',
      onSelect: () => void run('export', async () => platform.exportWorkspaceZip?.({ share: true })),
    }),
    {
      id: 'refresh',
      label: String(t('刷新工作区状态')),
      icon: IconRefresh,
      priority: 10,
      group: 'utility',
      collapseStrategy: 'overflow',
      renderControl: () => (
        <Tooltip label={t('刷新工作区状态')}>
          <ActionIcon
            size={44}
            variant="subtle"
            aria-label={String(t('刷新工作区状态'))}
            onClick={() => void refresh()}
          >
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>
      ),
      menuAction: { onSelect: () => void refresh() },
    },
  ]

  return (
    <Paper component="section" withBorder p="md" radius="md" aria-label={t('外部工作区与交付')}>
      <Stack gap="sm">
        <div>
          <Title order={2} size="h4">
            {t('外部工作区与交付')}
          </Title>
          <Text size="sm" c="dimmed">
            {workspace.available ? workspace.displayName || t('已授权目录') : t('尚未选择外部项目目录')}
          </Text>
        </div>
        <AdaptiveActionCluster
          className="yachiyo-workspace-delivery-actions"
          ariaLabel={String(t('外部工作区与交付'))}
          actions={actions}
        />
        {message && <Alert color="red">{t(message)}</Alert>}
      </Stack>
    </Paper>
  )
}
