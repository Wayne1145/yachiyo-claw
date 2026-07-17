import { Badge, Button, Code, Group, Loader, Stack, Table, Text, Title } from '@mantine/core'
import type { SessionAttachmentRagDebugSnapshot } from '@shared/types'
import { IconRefresh } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import platform from '@/platform'
import { runSessionAttachmentRagMaintenancePass } from '@/setup/session_attachment_rag_maintenance'

function formatTimestamp(value?: number) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function StatusBadge({ status }: { status: 'pending' | 'indexing' | 'ready' | 'failed' }) {
  const color = status === 'ready' ? 'green' : status === 'failed' ? 'red' : status === 'indexing' ? 'blue' : 'gray'
  return (
    <Badge color={color} variant="light">
      {status}
    </Badge>
  )
}

export function SessionAttachmentRagDevPane({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [maintaining, setMaintaining] = useState(false)
  const [snapshot, setSnapshot] = useState<SessionAttachmentRagDebugSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (platform.type !== 'desktop') {
      setError('Session-RAG debug pane is only available on desktop')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const data = await platform.getSessionAttachmentRagController().getDebugSnapshot()
      setSnapshot(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const clearAll = async () => {
    if (platform.type !== 'desktop') {
      return
    }
    if (!window.confirm('Clear all Session-RAG libsql data? This cannot be undone.')) {
      return
    }

    setClearing(true)
    setError(null)
    try {
      await platform.getSessionAttachmentRagController().clearAll()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setClearing(false)
    }
  }

  const runMaintenance = async () => {
    setMaintaining(true)
    setError(null)
    try {
      await runSessionAttachmentRagMaintenancePass()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMaintaining(false)
    }
  }

  useEffect(() => {
    if (opened) {
      void load()
    }
  }, [opened])

  return (
    <AdaptiveModal opened={opened} onClose={onClose} title="Session-RAG Dev Pane" size="xl">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">
            Inspect local libsql state for session attachment RAG.
          </Text>
          <Group gap="xs">
            <Button
              size="xs"
              variant="light"
              loading={maintaining}
              disabled={loading || clearing}
              onClick={() => void runMaintenance()}
            >
              Run Maintenance
            </Button>
            <Button
              size="xs"
              color="red"
              variant="light"
              loading={clearing}
              disabled={loading}
              onClick={() => void clearAll()}
            >
              Clear DB
            </Button>
            <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => void load()}>
              Refresh
            </Button>
          </Group>
        </Group>

        {loading && (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">Loading debug snapshot...</Text>
          </Group>
        )}

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        {snapshot && (
          <Stack gap="md">
            <div>
              <Title order={5}>Metadata Database</Title>
              <Code block>{snapshot.dbPath}</Code>
              <Text size="sm" mt="xs">
                Size: {snapshot.dbSizeBytes.toLocaleString()} bytes
              </Text>
            </div>

            <div>
              <Title order={5}>Vector Database</Title>
              <Code block>{snapshot.vectorDbPath}</Code>
              <Text size="sm" mt="xs">
                Size: {snapshot.vectorDbSizeBytes.toLocaleString()} bytes
              </Text>
            </div>

            <div>
              <Title order={5}>Counts</Title>
              <Group gap="xs">
                <Badge variant="light">attachments {snapshot.attachmentCount}</Badge>
                <Badge variant="light">parents {snapshot.parentCount}</Badge>
                <Badge variant="light">chunks {snapshot.chunkCount}</Badge>
                <Badge variant="light">vector indexes {snapshot.vectorIndexNames.length}</Badge>
              </Group>
            </div>

            <div>
              <Title order={5}>Status</Title>
              <Group gap="xs">
                <Badge color="gray" variant="light">
                  pending {snapshot.statusCounts.pending}
                </Badge>
                <Badge color="blue" variant="light">
                  indexing {snapshot.statusCounts.indexing}
                </Badge>
                <Badge color="green" variant="light">
                  ready {snapshot.statusCounts.ready}
                </Badge>
                <Badge color="red" variant="light">
                  failed {snapshot.statusCounts.failed}
                </Badge>
              </Group>
            </div>

            <div>
              <Title order={5}>Vector Index Names</Title>
              <Code block>{snapshot.vectorIndexNames.length ? snapshot.vectorIndexNames.join('\n') : '(none)'}</Code>
            </div>

            <div>
              <Title order={5}>Recent Attachments</Title>
              <Table withTableBorder withColumnBorders striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>ID</Table.Th>
                    <Table.Th>File</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Chunks</Table.Th>
                    <Table.Th>Parser</Table.Th>
                    <Table.Th>Error</Table.Th>
                    <Table.Th>Created</Table.Th>
                    <Table.Th>Started</Table.Th>
                    <Table.Th>Completed</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {snapshot.recentAttachments.map((attachment) => (
                    <Table.Tr key={attachment.id}>
                      <Table.Td>{attachment.id}</Table.Td>
                      <Table.Td>{attachment.filename}</Table.Td>
                      <Table.Td>
                        <StatusBadge status={attachment.status} />
                      </Table.Td>
                      <Table.Td>{attachment.chunkCount ?? 0}</Table.Td>
                      <Table.Td>{attachment.parserType ?? '-'}</Table.Td>
                      <Table.Td>
                        <Text size="xs" maw={260} lineClamp={3}>
                          {attachment.error ?? '-'}
                        </Text>
                      </Table.Td>
                      <Table.Td>{formatTimestamp(attachment.createdAt)}</Table.Td>
                      <Table.Td>{formatTimestamp(attachment.processingStartedAt)}</Table.Td>
                      <Table.Td>{formatTimestamp(attachment.completedAt)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </Stack>
        )}
      </Stack>
    </AdaptiveModal>
  )
}

export default SessionAttachmentRagDevPane
