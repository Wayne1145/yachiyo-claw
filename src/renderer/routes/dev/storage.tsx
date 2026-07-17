import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  Container,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { IconDatabase, IconEye, IconFile, IconRefresh, IconSearch } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import storage from '@/storage'

export const Route = createFileRoute('/dev/storage')({
  component: StorageViewerPage,
})

type StorageEntry = {
  key: string
  type: string
  stringified: string
  preview: string
  size: number
}

type DetailState =
  | { type: 'kv'; entry: StorageEntry }
  | { type: 'blob'; key: string; content: string | null; loading: boolean; error?: string }

function StorageViewerPage() {
  const [entries, setEntries] = useState<StorageEntry[]>([])
  const [blobKeys, setBlobKeys] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<DetailState | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [allValues, allBlobKeys] = await Promise.all([storage.getAll(), storage.getBlobKeys()])

      const normalizedEntries = Object.entries(allValues)
        .map(([key, value]) => {
          const stringified = safeStringify(value)
          return {
            key,
            type: detectType(value),
            stringified,
            preview: buildPreview(stringified),
            size: stringified.length,
          }
        })
        .sort((a, b) => a.key.localeCompare(b.key))

      setEntries(normalizedEntries)
      setBlobKeys([...allBlobKeys].sort())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load storage data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filteredEntries = useMemo(() => {
    if (!search.trim()) return entries
    const keyword = search.trim().toLowerCase()
    return entries.filter((entry) =>
      [entry.key.toLowerCase(), entry.preview.toLowerCase()].some((field) => field.includes(keyword))
    )
  }, [entries, search])

  const filteredBlobKeys = useMemo(() => {
    if (!search.trim()) return blobKeys
    const keyword = search.trim().toLowerCase()
    return blobKeys.filter((key) => key.toLowerCase().includes(keyword))
  }, [blobKeys, search])

  const openEntryDetail = useCallback((entry: StorageEntry) => {
    setDetail({ type: 'kv', entry })
  }, [])

  const openBlobDetail = useCallback((key: string) => {
    setDetail({ type: 'blob', key, content: null, loading: true })

    void storage
      .getBlob(key)
      .then((content) => {
        setDetail((prev) => {
          if (!prev || prev.type !== 'blob' || prev.key !== key) return prev
          return { ...prev, content, loading: false }
        })
      })
      .catch((err) => {
        setDetail((prev) => {
          if (!prev || prev.type !== 'blob' || prev.key !== key) return prev
          return {
            ...prev,
            error: err instanceof Error ? err.message : 'Failed to load blob content',
            loading: false,
          }
        })
      })
  }, [])

  const closeDetail = useCallback(() => {
    setDetail(null)
  }, [])

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <Group justify="space-between" align="center">
          <div>
            <Group gap="xs" mb="xs">
              <IconDatabase size={22} />
              <Title order={2}>Storage Explorer</Title>
              <Badge variant="light" color="blue">
                {entries.length} entries
              </Badge>
            </Group>
            <Text c="dimmed">
              Inspect all persisted key-value records and blob payloads from the platform storage implementation.
            </Text>
          </div>
          <Group gap="xs">
            <Tooltip label="Refresh">
              <ActionIcon variant="light" onClick={() => void loadData()} disabled={loading} size="lg">
                {loading ? <Loader size="sm" /> : <IconRefresh size={18} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <TextInput
          placeholder="Search by key or preview"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />

        {error && (
          <Paper withBorder p="md" radius="md" c="red">
            <Text size="sm">{error}</Text>
          </Paper>
        )}

        <Paper withBorder shadow="xs" radius="md" p="md">
          <Stack gap="sm">
            <Group justify="space-between" align="center">
              <Group gap="xs">
                <IconDatabase size={18} />
                <Text fw={600}>Key-Value Store</Text>
                <Badge color="gray" variant="light">
                  {entries.length}
                </Badge>
              </Group>
              <Text size="sm" c="dimmed">
                Preview stored JSON values. Click "View" to open the full payload.
              </Text>
            </Group>

            <ScrollArea h={340} type="auto">
              <Table highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: '40%' }}>Key</Table.Th>
                    <Table.Th style={{ width: '15%' }}>Type</Table.Th>
                    <Table.Th>Preview</Table.Th>
                    <Table.Th style={{ width: 100 }}>Size</Table.Th>
                    <Table.Th style={{ width: 90 }}>Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredEntries.map((entry) => (
                    <Table.Tr key={entry.key}>
                      <Table.Td>
                        <Code>{entry.key}</Code>
                      </Table.Td>
                      <Table.Td>
                        <Badge color="gray" variant="light">
                          {entry.type}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {entry.preview}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{formatSize(entry.size)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Button
                          variant="subtle"
                          size="xs"
                          leftSection={<IconEye size={16} />}
                          onClick={() => openEntryDetail(entry)}
                        >
                          View
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {filteredEntries.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={5}>
                        <Text c="dimmed" ta="center">
                          {entries.length === 0
                            ? 'No stored key-value data found.'
                            : 'No items match the current filter.'}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Stack>
        </Paper>

        <Paper withBorder shadow="xs" radius="md" p="md">
          <Group gap="xs" mb="md">
            <IconFile size={18} />
            <Text fw={600}>Blob Store</Text>
            <Badge color="gray" variant="light">
              {blobKeys.length}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed" mb="sm">
            Blob payloads are stored separately (e.g. large text, files, parsed content). Select a key to load its
            contents.
          </Text>

          <ScrollArea h={220} type="auto">
            <Stack gap="xs">
              {filteredBlobKeys.map((key) => (
                <Group key={key} justify="space-between" align="center" wrap="nowrap">
                  <Box style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                    <Code>{key}</Code>
                  </Box>
                  <Button
                    variant="light"
                    size="xs"
                    onClick={() => openBlobDetail(key)}
                    leftSection={<IconEye size={16} />}
                  >
                    View
                  </Button>
                </Group>
              ))}
              {filteredBlobKeys.length === 0 && (
                <Text c="dimmed" ta="center">
                  {blobKeys.length === 0 ? 'No blob entries found.' : 'No blob keys match the current filter.'}
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Paper>
      </Stack>

      <AdaptiveModal
        opened={detail !== null}
        onClose={closeDetail}
        size="xl"
        title={detail ? renderModalTitle(detail) : ''}
      >
        {detail?.type === 'kv' && (
          <Stack gap="sm">
            <Group gap="xs">
              <Badge color="gray" variant="light">
                {detail.entry.type}
              </Badge>
              <Text size="sm" c="dimmed">
                Size: {formatSize(detail.entry.size)}
              </Text>
            </Group>
            <ScrollArea h={420} type="auto">
              <Code block>{detail.entry.stringified}</Code>
            </ScrollArea>
          </Stack>
        )}

        {detail?.type === 'blob' && (
          <Stack gap="sm">
            {detail.loading && (
              <Group justify="center" py="lg">
                <Loader />
              </Group>
            )}
            {!detail.loading && detail.error && <Text c="red">{detail.error}</Text>}
            {!detail.loading && !detail.error && (
              <ScrollArea h={420} type="auto">
                <Code block>{detail.content ?? 'null'}</Code>
              </ScrollArea>
            )}
          </Stack>
        )}
      </AdaptiveModal>
    </Container>
  )
}

function detectType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const type = typeof value
  if (type === 'object') return 'object'
  return type
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    return String(value)
  }
}

function buildPreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 120) return normalized
  return `${normalized.slice(0, 120)}…`
}

function formatSize(length: number): string {
  if (length < 1024) return `${length} B`
  if (length < 1024 * 1024) return `${(length / 1024).toFixed(1)} KB`
  return `${(length / 1024 / 1024).toFixed(1)} MB`
}

function renderModalTitle(detail: DetailState): string {
  if (detail.type === 'kv') {
    return detail.entry.key
  }
  return detail.key
}

export default StorageViewerPage
