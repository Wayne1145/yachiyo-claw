import { Badge, Button, Flex, Loader, Stack, Text, TextInput } from '@mantine/core'
import {
  IconGitFork,
  IconMessageCircle,
  IconPlus,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconTrash,
} from '@tabler/icons-react'
import { type PointerEvent, useMemo, useRef, useState } from 'react'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import {
  ensureChatSessionForTask,
  findTaskForChatSession,
  openChatSessionAsAgent,
  openTaskSessionAsChat,
} from '@/mobile/conversation-bridge'
import { copyAgentSessionConfig, deleteAgentSessionConfig } from '@/mobile/agent-session-config'
import {
  createSession,
  deleteSession,
  getSession,
  updateSession,
  useSessionList,
} from '@/stores/chatStore'
import { createEmpty, switchCurrentSession } from '@/stores/sessionActions'
import { deleteTaskSession, taskSessionStore, useTaskSessionHistory } from '@/stores/taskSessionStore'

type ConversationMode = 'chat' | 'agent'

export function AndroidConversationHistory({
  opened,
  mode,
  currentId,
  onClose,
  onSelectSession,
}: {
  opened: boolean
  mode: ConversationMode
  currentId?: string
  onClose: () => void
  onSelectSession?: (sessionId: string) => void | Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [openingId, setOpeningId] = useState<string>()
  const chats = useSessionList()
  const tasks = useTaskSessionHistory(50)
  const taskItems = tasks.data?.pages.flatMap((page) => page.items) || []

  const records = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    const chatRecords = (chats.sessionMetaList || []).map((session) => ({
      id: session.id,
      kind: 'chat' as const,
      name: session.name || '新对话',
      timestamp: session.createdAt,
      shared: taskItems.some((task) => task.linkedSessionId === session.id),
      linkedTaskId: taskItems.find((task) => task.linkedSessionId === session.id)?.id,
      starred: Boolean(session.starred),
    }))
    const legacyTasks = taskItems
      .filter((task) => !task.linkedSessionId)
      .map((task) => ({
        id: task.id,
        kind: 'task' as const,
        name: task.name || 'Agent 对话',
        timestamp: task.updatedAt || task.createdAt,
        shared: false,
        starred: false,
        linkedTaskId: undefined,
      }))

    return [...chatRecords, ...legacyTasks]
      .filter((record) => !normalizedSearch || record.name.toLocaleLowerCase().includes(normalizedSearch))
      .sort((left, right) => right.timestamp - left.timestamp)
  }, [chats.sessionMetaList, search, taskItems])

  const openRecord = async (record: (typeof records)[number]) => {
    setOpeningId(record.id)
    try {
      if (onSelectSession) {
        const sessionId = record.kind === 'task' ? await ensureChatSessionForTask(record.id) : record.id
        await onSelectSession(sessionId)
        onClose()
        return
      }
      if (mode === 'agent') {
        if (record.kind === 'task') {
          taskSessionStore.getState().setCurrentTaskId(record.id)
          const { router } = await import('@/router')
          await router.navigate({ to: '/task/$taskId', params: { taskId: record.id } })
        } else {
          await openChatSessionAsAgent(record.id)
        }
      } else if (record.kind === 'task') {
        await openTaskSessionAsChat(record.id)
      } else {
        switchCurrentSession(record.id)
      }
      onClose()
    } finally {
      setOpeningId(undefined)
    }
  }

  const createConversation = async () => {
    setOpeningId('new')
    try {
      const session = await createEmpty('chat')
      if (onSelectSession) {
        await onSelectSession(session.id)
        onClose()
        return
      }
      if (mode === 'agent') await openChatSessionAsAgent(session.id)
      onClose()
    } finally {
      setOpeningId(undefined)
    }
  }

  const favoriteRecord = async (record: (typeof records)[number]) => {
    const sessionId = record.kind === 'task' ? await ensureChatSessionForTask(record.id) : record.id
    await updateSession(sessionId, { starred: !record.starred })
  }

  const forkRecord = async (record: (typeof records)[number]) => {
    const sourceId = record.kind === 'task' ? await ensureChatSessionForTask(record.id) : record.id
    const source = await getSession(sourceId)
    if (!source) return
    const { id: _id, ...copy } = structuredClone(source)
    const fork = await createSession({ ...copy, name: `${source.name} · 分支`, starred: false }, source.id)
    copyAgentSessionConfig(sourceId, fork.id)
    await openRecord({
      id: fork.id,
      kind: 'chat',
      name: fork.name,
      timestamp: Date.now(),
      shared: false,
      starred: false,
      linkedTaskId: undefined,
    })
  }

  const deleteRecord = async (record: (typeof records)[number]) => {
    if (record.kind === 'task') {
      await deleteTaskSession(record.id)
      deleteAgentSessionConfig(record.id)
    } else {
      const linked = await findTaskForChatSession(record.id)
      if (linked) {
        await deleteTaskSession(linked.id)
        deleteAgentSessionConfig(linked.id)
      }
      await deleteSession(record.id)
      deleteAgentSessionConfig(record.id)
    }
    if (record.id === currentId || record.linkedTaskId === currentId) {
      const { router } = await import('@/router')
      await router.navigate({ to: '/', replace: true })
      onClose()
    }
  }

  return (
    <AdaptiveModal opened={opened} onClose={onClose} title="会话记录" centered size="lg">
      <Stack gap="md" className="yachiyo-history-dialog">
        <Flex gap="sm">
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            leftSection={<IconSearch size={17} />}
            placeholder="搜索会话"
            className="yachiyo-history-search"
          />
          <Button
            leftSection={<IconPlus size={17} />}
            loading={openingId === 'new'}
            onClick={() => void createConversation()}
          >
            新建
          </Button>
        </Flex>

        {!chats.sessionMetaList && !tasks.data ? (
          <Flex justify="center" py="xl">
            <Loader size="sm" />
          </Flex>
        ) : records.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            暂无会话
          </Text>
        ) : (
          <Stack gap={6} className="yachiyo-history-list">
            {records.map((record) => (
              <SwipeHistoryItem
                key={`${record.kind}:${record.id}`}
                record={record}
                active={record.id === currentId || record.linkedTaskId === currentId}
                loading={openingId === record.id}
                disabled={Boolean(openingId)}
                onOpen={() => void openRecord(record)}
                onFavorite={() => void favoriteRecord(record)}
                onFork={() => void forkRecord(record)}
                onDelete={() => void deleteRecord(record)}
              />
            ))}
          </Stack>
        )}

        {(chats.hasNextPage || tasks.hasNextPage) && (
          <Button
            variant="subtle"
            loading={chats.isFetchingNextPage || tasks.isFetchingNextPage}
            onClick={() => {
              if (chats.hasNextPage) void chats.fetchNextPage()
              if (tasks.hasNextPage) void tasks.fetchNextPage()
            }}
          >
            加载更多
          </Button>
        )}
      </Stack>
    </AdaptiveModal>
  )
}

type HistoryRecord = {
  id: string
  kind: 'chat' | 'task'
  name: string
  timestamp: number
  shared: boolean
  starred: boolean
  linkedTaskId?: string
}

function SwipeHistoryItem({
  record,
  active,
  loading,
  disabled,
  onOpen,
  onFavorite,
  onFork,
  onDelete,
}: {
  record: HistoryRecord
  active: boolean
  loading: boolean
  disabled: boolean
  onOpen: () => void
  onFavorite: () => void
  onFork: () => void
  onDelete: () => void
}) {
  const [offset, setOffset] = useState(0)
  const drag = useRef<{ x: number; y: number; startOffset: number; horizontal?: boolean } | null>(null)

  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, startOffset: offset }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return
    const dx = event.clientX - drag.current.x
    const dy = event.clientY - drag.current.y
    if (drag.current.horizontal === undefined && Math.abs(dx) + Math.abs(dy) > 8) {
      drag.current.horizontal = Math.abs(dx) > Math.abs(dy)
    }
    if (!drag.current.horizontal) return
    event.preventDefault()
    setOffset(Math.max(-198, Math.min(0, drag.current.startOffset + dx)))
  }

  const pointerUp = () => {
    if (!drag.current) return
    const wasHorizontal = drag.current.horizontal
    drag.current = null
    if (wasHorizontal) setOffset((current) => (current < -48 ? -198 : 0))
  }

  const runAction = (action: () => void) => {
    setOffset(0)
    action()
  }

  return (
    <div className="yachiyo-history-swipe">
      <div className="yachiyo-history-actions" aria-hidden={offset === 0}>
        <button type="button" data-action="favorite" disabled={offset === 0} onClick={() => runAction(onFavorite)}>
          {record.starred ? <IconStarFilled size={19} /> : <IconStar size={19} />}
          <span>{record.starred ? '取消收藏' : '收藏'}</span>
        </button>
        <button type="button" data-action="fork" disabled={offset === 0} onClick={() => runAction(onFork)}>
          <IconGitFork size={19} />
          <span>分叉</span>
        </button>
        <button type="button" data-action="delete" disabled={offset === 0} onClick={() => runAction(onDelete)}>
          <IconTrash size={19} />
          <span>删除</span>
        </button>
      </div>
      <button
        type="button"
        className="yachiyo-history-item"
        data-active={active ? 'true' : 'false'}
        disabled={disabled}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onClick={() => {
          if (offset !== 0) setOffset(0)
          else onOpen()
        }}
      >
        <span className="yachiyo-history-icon">
          {loading ? <Loader size={17} /> : <IconMessageCircle size={19} />}
        </span>
        <span className="yachiyo-history-copy">
          <strong>{record.name}</strong>
          <small>{new Date(record.timestamp).toLocaleString()}</small>
        </span>
        <Badge variant="light" color={record.shared ? 'chatbox-brand' : 'gray'}>
          {record.shared ? 'Agent 可用' : '聊天'}
        </Badge>
      </button>
    </div>
  )
}
