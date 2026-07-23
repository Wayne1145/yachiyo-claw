import { ActionIcon, Badge, Button, Divider, Group, Loader, Stack, Text, Textarea, Title } from '@mantine/core'
import type { MemoryItem } from '@shared/memory'
import { IconRefresh, IconTrash } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { createDefaultLongTermMemoryService } from '@/mobile/long-term-memory'
import {
  getSharedUserContext,
  saveSharedUserContext,
  type SharedUserContext,
} from '@/mobile/shared-user-context'

export const Route = createFileRoute('/settings/user-memory')({ component: UserMemorySettingsPage })

function UserMemorySettingsPage() {
  const [value, setValue] = useState(getSharedUserContext)
  const [saved, setSaved] = useState(false)
  const [records, setRecords] = useState<MemoryItem[]>([])
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [recordError, setRecordError] = useState('')
  const [lastDeleted, setLastDeleted] = useState<MemoryItem>()
  const memoryService = useMemo(() => createDefaultLongTermMemoryService(), [])
  const patch = (next: Partial<SharedUserContext>) => {
    setSaved(false)
    setValue((current) => ({ ...current, ...next }))
  }

  const save = () => {
    saveSharedUserContext(value)
    setSaved(true)
  }

  const refreshRecords = async () => {
    setLoadingRecords(true)
    setRecordError('')
    try {
      setRecords((await memoryService.list({ includeSensitive: false })).sort((a, b) => b.updatedAt - a.updatedAt))
    } catch (cause) {
      setRecordError(cause instanceof Error ? cause.message : '无法读取长期记忆')
    } finally {
      setLoadingRecords(false)
    }
  }

  useEffect(() => {
    void refreshRecords()
  }, [])

  const updateRecord = async (record: MemoryItem) => {
    setRecordError('')
    try {
      await memoryService.update(record.id, { content: record.content, kind: record.kind, tags: record.tags })
      await refreshRecords()
    } catch (cause) {
      setRecordError(cause instanceof Error ? cause.message : '无法保存记忆')
    }
  }

  const deleteRecord = async (record: MemoryItem) => {
    if (!(await memoryService.remove(record.id))) return
    setLastDeleted(record)
    await refreshRecords()
  }

  const undoDelete = async () => {
    if (!lastDeleted) return
    await memoryService.saveCandidate({
      content: lastDeleted.content,
      kind: lastDeleted.kind,
      confidence: lastDeleted.confidence,
      sensitivity: lastDeleted.sensitivity,
      tags: lastDeleted.tags,
      sourceSessionId: lastDeleted.sourceSessionId,
      sourceMessageId: lastDeleted.sourceMessageId,
      expiresAt: lastDeleted.expiresAt,
    })
    setLastDeleted(undefined)
    await refreshRecords()
  }

  return (
    <main className="yachiyo-character-settings">
      <Title order={1}>用户与记忆</Title>
      <Text c="dimmed" mb="md">
        这些内容会作为隐藏上下文用于普通聊天和 Agent，不会显示在聊天记录中。
      </Text>
      <section className="yachiyo-character-editor">
        <Textarea
          label="用户画像"
          description="填写称呼、偏好、背景和沟通习惯。"
          placeholder="例如：称呼我为 Wayne；优先使用中文回答。"
          autosize
          minRows={7}
          maxRows={16}
          value={value.userProfile}
          onChange={(event) => patch({ userProfile: event.currentTarget.value })}
        />
        <Textarea
          label="长期记忆"
          description="记录需要跨对话保留的事实和约定。"
          placeholder="例如：项目默认使用 pnpm；修改后运行 Android 检查。"
          autosize
          minRows={10}
          maxRows={22}
          value={value.memory}
          onChange={(event) => patch({ memory: event.currentTarget.value })}
        />
        <Stack gap="xs">
          <Button onClick={save}>保存用户与记忆</Button>
          {saved && (
            <Text size="sm" c="green">
              已保存，将从下一次模型请求开始生效。
            </Text>
          )}
        </Stack>
        <Divider my="sm" />
        <Group justify="space-between" align="center">
          <div>
            <Text fw={700}>自动长期记忆</Text>
            <Text size="sm" c="dimmed">
              模型和宿主从明确表达中保存的稳定信息。凭据和敏感内容不会写入。
            </Text>
          </div>
          <ActionIcon variant="subtle" color="gray" aria-label="刷新长期记忆" onClick={() => void refreshRecords()}>
            <IconRefresh size={18} />
          </ActionIcon>
        </Group>
        {lastDeleted && (
          <Group justify="space-between" p="sm" style={{ borderRadius: 12, background: '#fff2f6' }}>
            <Text size="sm">已删除一条记忆</Text>
            <Button size="compact-sm" variant="subtle" color="pink" onClick={() => void undoDelete()}>
              撤销
            </Button>
          </Group>
        )}
        {recordError && (
          <Text size="sm" c="red" role="alert">
            {recordError}
          </Text>
        )}
        {loadingRecords ? (
          <Loader color="pink" size="sm" />
        ) : records.length === 0 ? (
          <Text size="sm" c="dimmed">还没有自动长期记忆。</Text>
        ) : (
          <Stack gap="sm">
            {records.map((record) => (
              <section key={record.id} style={{ border: '1px solid #e4e7e9', borderRadius: 14, padding: 14 }}>
                <Group justify="space-between" mb="xs">
                  <Group gap={6}>
                    <Badge color="pink" variant="light">{record.kind}</Badge>
                    {record.tags.map((tag) => (
                      <Badge key={tag} color="gray" variant="light">{tag}</Badge>
                    ))}
                  </Group>
                  <ActionIcon color="red" variant="subtle" aria-label="删除记忆" onClick={() => void deleteRecord(record)}>
                    <IconTrash size={17} />
                  </ActionIcon>
                </Group>
                <Textarea
                  autosize
                  minRows={2}
                  maxRows={8}
                  value={record.content}
                  onChange={(event) => {
                    const content = event.currentTarget.value
                    setRecords((current) => current.map((item) => item.id === record.id ? { ...item, content } : item))
                  }}
                />
                <Group justify="space-between" mt="xs">
                  <Text size="xs" c="dimmed">
                    {record.sourceSessionId ? `来源对话 ${record.sourceSessionId.slice(0, 8)} · ` : ''}
                    {new Date(record.updatedAt).toLocaleString()}
                  </Text>
                  <Button size="compact-sm" radius="xl" variant="light" color="pink" onClick={() => void updateRecord(record)}>
                    保存修改
                  </Button>
                </Group>
              </section>
            ))}
            <Button
              variant="subtle"
              color="red"
              onClick={() => {
                if (!window.confirm('确定清空全部自动长期记忆吗？此操作不可撤销。')) return
                void memoryService.clear().then(refreshRecords)
              }}
            >
              清空自动长期记忆
            </Button>
          </Stack>
        )}
      </section>
    </main>
  )
}
