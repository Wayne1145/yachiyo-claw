import { Alert, Button, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { IconDownload, IconFolderOpen, IconRefresh, IconShare, IconUpload } from '@tabler/icons-react'
import { useCallback, useEffect, useState } from 'react'
import platform from '@/platform'

type WorkspaceState = Awaited<ReturnType<NonNullable<typeof platform.externalWorkspaceStatus>>>

export function AndroidWorkspaceDeliveryPanel() {
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
      if (!platform.pickExternalWorkspace || !platform.syncExternalWorkspace) throw new Error('external_workspace_unavailable')
      const selected = await platform.pickExternalWorkspace()
      if (selected.canceled || !selected.workspaceKey) return
      const imported = await platform.syncExternalWorkspace('in')
      if (!imported.success) throw new Error(imported.error || 'workspace_sync_in_failed')
      const initialized = await platform.sandboxInit?.({ workingDirectory: selected.workspaceKey })
      if (initialized && !initialized.success) throw new Error(initialized.error || 'sandbox_init_failed')
    })

  return (
    <Paper component="section" withBorder p="md" radius="md" aria-label="外部工作区与交付">
      <Stack gap="sm">
        <div>
          <Title order={2} size="h4">
            外部工作区与交付
          </Title>
          <Text size="sm" c="dimmed">
            {workspace.available ? workspace.displayName || '已授权目录' : '尚未选择外部项目目录'}
          </Text>
        </div>
        <Group gap="xs" wrap="wrap">
          <Button
            variant="light"
            leftSection={<IconFolderOpen size={16} />}
            loading={busy === 'choose'}
            onClick={() => void choose()}
          >
            选择并导入
          </Button>
          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            disabled={!workspace.available}
            loading={busy === 'in'}
            onClick={() => void run('in', async () => platform.syncExternalWorkspace?.('in'))}
          >
            重新导入
          </Button>
          <Button
            variant="light"
            leftSection={<IconUpload size={16} />}
            disabled={!workspace.available}
            loading={busy === 'out'}
            onClick={() => void run('out', async () => platform.syncExternalWorkspace?.('out'))}
          >
            写回目录
          </Button>
          <Button
            variant="light"
            leftSection={<IconShare size={16} />}
            disabled={!workspace.available}
            loading={busy === 'export'}
            onClick={() => void run('export', async () => platform.exportWorkspaceZip?.({ share: true }))}
          >
            导出 ZIP
          </Button>
          <Button variant="subtle" aria-label="刷新工作区状态" onClick={() => void refresh()}>
            <IconRefresh size={16} />
          </Button>
        </Group>
        {message && <Alert color="red">{message}</Alert>}
      </Stack>
    </Paper>
  )
}
