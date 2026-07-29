import { Badge, Button, Flex, Loader, Modal, Stack, Text, TextInput } from '@mantine/core'
import {
  IconGitFork,
  IconMessageCircle,
  IconPencil,
  IconPlus,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconTrash,
} from '@tabler/icons-react'
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion'
import { type CSSProperties, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  pruneAbandonedEmptySessions,
  updateSession,
  useSessionList,
} from '@/stores/chatStore'
import { createEmpty, switchCurrentSession } from '@/stores/sessionActions'
import {
  deleteTaskSession,
  taskSessionStore,
  updateTaskSession,
  useTaskSessionHistory,
} from '@/stores/taskSessionStore'
import {
  appendAndroidHistorySwipeSample,
  estimateAndroidHistorySwipeVelocity,
  getAndroidHistoryActionWidth,
  resolveAndroidHistorySwipeAxis,
  rubberBandAndroidHistoryOffset,
  shouldToggleAndroidHistorySwipe,
  type AndroidHistorySwipeAxis,
  type AndroidHistorySwipeSample,
} from './android-conversation-swipe-physics'

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
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState('')
  const [openingId, setOpeningId] = useState<string>()
  const [renameTarget, setRenameTarget] = useState<HistoryRecord | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const chats = useSessionList()
  const tasks = useTaskSessionHistory(50)
  const taskItems = useMemo(() => tasks.data?.pages.flatMap((page) => page.items) || [], [tasks.data?.pages])

  useEffect(() => {
    if (!opened) return
    const protectedIds = new Set(
      taskItems.map((task) => task.linkedSessionId).filter((id): id is string => Boolean(id))
    )
    void pruneAbandonedEmptySessions(60_000, protectedIds)
  }, [opened, taskItems])

  const records = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    const chatRecords = (chats.sessionMetaList || []).map((session) => ({
      id: session.id,
      kind: 'chat' as const,
      name: session.name || String(t('新对话')),
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
        name: task.name || String(t('Agent 对话')),
        timestamp: task.updatedAt || task.createdAt,
        shared: false,
        starred: false,
        linkedTaskId: undefined,
      }))

    return [...chatRecords, ...legacyTasks]
      .filter((record) => !normalizedSearch || record.name.toLocaleLowerCase().includes(normalizedSearch))
      .sort((left, right) => right.timestamp - left.timestamp)
  }, [chats.sessionMetaList, search, taskItems, t])

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
      const protectedIds = new Set(
        taskItems.map((task) => task.linkedSessionId).filter((id): id is string => Boolean(id))
      )
      await pruneAbandonedEmptySessions(0, protectedIds)
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
    const fork = await createSession({ ...copy, name: `${source.name} · ${t('分支')}`, starred: false }, source.id)
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

  const openRename = (record: HistoryRecord) => {
    setRenameTarget(record)
    setRenameValue(record.name)
  }

  const renameRecord = async () => {
    const record = renameTarget
    const name = renameValue.trim()
    if (!record || !name || renaming) return
    setRenaming(true)
    try {
      if (record.kind === 'task') {
        await updateTaskSession(record.id, { name })
      } else {
        await updateSession(record.id, { name })
        if (record.linkedTaskId) await updateTaskSession(record.linkedTaskId, { name })
      }
      setRenameTarget(null)
    } finally {
      setRenaming(false)
    }
  }

  return (
    <AdaptiveModal opened={opened} onClose={onClose} title={t('会话记录')} centered size="lg">
      <Stack gap="md" className="yachiyo-history-dialog">
        <Flex gap="sm">
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            leftSection={<IconSearch size={17} />}
            placeholder={String(t('搜索会话'))}
            className="yachiyo-history-search"
          />
          <Button
            leftSection={<IconPlus size={17} />}
            loading={openingId === 'new'}
            onClick={() => void createConversation()}
          >
            {t('新建')}
          </Button>
        </Flex>

        {!chats.sessionMetaList && !tasks.data ? (
          <Flex justify="center" py="xl">
            <Loader size="sm" />
          </Flex>
        ) : records.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            {t('暂无会话')}
          </Text>
        ) : (
          <Stack gap={6} className="yachiyo-history-list">
            {records.map((record) => (
              <SwipeHistoryItem
                key={`${record.kind}:${record.id}`}
                record={record}
                opened={opened}
                active={record.id === currentId || record.linkedTaskId === currentId}
                loading={openingId === record.id}
                disabled={Boolean(openingId)}
                onOpen={() => void openRecord(record)}
                onFavorite={() => void favoriteRecord(record)}
                onRename={() => openRename(record)}
                onFork={() => void forkRecord(record)}
                onDelete={() => void deleteRecord(record)}
                locale={i18n.resolvedLanguage || i18n.language}
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
            {t('加载更多')}
          </Button>
        )}
      </Stack>
      <Modal
        opened={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title={t('重命名会话')}
        centered
        radius="lg"
      >
        <Stack gap="md">
          <TextInput
            value={renameValue}
            onChange={(event) => setRenameValue(event.currentTarget.value)}
            label={t('会话名称')}
            autoFocus
            maxLength={120}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void renameRecord()
            }}
          />
          <Flex justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setRenameTarget(null)}>
              {t('取消')}
            </Button>
            <Button loading={renaming} disabled={!renameValue.trim()} onClick={() => void renameRecord()}>
              {t('保存')}
            </Button>
          </Flex>
        </Stack>
      </Modal>
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

type HistorySwipeDrag = {
  pointerId: number
  x: number
  y: number
  startOffset: number
  sourceOpen: boolean
  dimension: number
  axis: AndroidHistorySwipeAxis
  samples: AndroidHistorySwipeSample[]
}

type HistorySwipePhase = 'idle' | 'tracking' | 'settling'

function SwipeHistoryItem({
  record,
  opened,
  active,
  loading,
  disabled,
  onOpen,
  onFavorite,
  onRename,
  onFork,
  onDelete,
  locale,
}: {
  record: HistoryRecord
  opened: boolean
  active: boolean
  loading: boolean
  disabled: boolean
  onOpen: () => void
  onFavorite: () => void
  onRename: () => void
  onFork: () => void
  onDelete: () => void
  locale: string
}) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const offset = useMotionValue(0)
  const [phase, setPhase] = useState<HistorySwipePhase>('idle')
  const [actionsVisible, setActionsVisible] = useState(false)
  const drag = useRef<HistorySwipeDrag | null>(null)
  const openRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const animationRef = useRef<ReturnType<typeof animate> | null>(null)
  const animationIdRef = useRef(0)

  const actions = [
    {
      id: 'favorite',
      label: record.starred ? t('取消收藏') : t('收藏'),
      icon: record.starred ? <IconStarFilled size={19} /> : <IconStar size={19} />,
      run: onFavorite,
    },
    { id: 'rename', label: t('重命名'), icon: <IconPencil size={19} />, run: onRename },
    { id: 'fork', label: t('分叉'), icon: <IconGitFork size={19} />, run: onFork },
    { id: 'delete', label: t('删除'), icon: <IconTrash size={19} />, run: onDelete },
  ] as const
  const actionWidth = getAndroidHistoryActionWidth(actions.length)

  const stopAnimation = useCallback(() => {
    animationIdRef.current += 1
    animationRef.current?.stop()
    animationRef.current = null
  }, [])

  const settleTo = (targetOpen: boolean, velocity = 0) => {
    stopAnimation()
    openRef.current = targetOpen
    const target = targetOpen ? -actionWidth : 0
    if (Math.abs(offset.get() - target) < 0.5) {
      offset.set(target)
      setActionsVisible(targetOpen)
      setPhase('idle')
      return
    }

    setActionsVisible(true)
    setPhase('settling')
    const animationId = animationIdRef.current
    const controls = animate(
      offset,
      target,
      reducedMotion
        ? { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }
        : {
            type: 'spring',
            mass: 1,
            stiffness: 420,
            damping: Math.abs(velocity) >= 80 ? 34 : 40,
            velocity,
            restDelta: 0.25,
            restSpeed: 8,
          }
    )
    animationRef.current = controls
    void controls.then(() => {
      if (animationId !== animationIdRef.current) return
      offset.set(target)
      animationRef.current = null
      setActionsVisible(targetOpen)
      setPhase('idle')
    })
  }

  useEffect(() => {
    stopAnimation()
    drag.current = null
    openRef.current = false
    suppressNextClickRef.current = false
    offset.set(0)
    setActionsVisible(false)
    setPhase('idle')
  }, [opened, active, offset, stopAnimation])

  useEffect(
    () => () => {
      stopAnimation()
      drag.current = null
    },
    [stopAnimation]
  )

  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return
    stopAnimation()
    const currentOffset = offset.get()
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startOffset: currentOffset,
      sourceOpen: openRef.current,
      dimension: Math.max(event.currentTarget.clientWidth, actionWidth),
      axis: 'pending',
      samples: [{ position: event.clientX, time: event.timeStamp }],
    }
  }

  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const currentDrag = drag.current
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return
    currentDrag.samples = appendAndroidHistorySwipeSample(currentDrag.samples, {
      position: event.clientX,
      time: event.timeStamp,
    })
    const dx = event.clientX - currentDrag.x
    const dy = event.clientY - currentDrag.y
    if (currentDrag.axis === 'pending') {
      currentDrag.axis = resolveAndroidHistorySwipeAxis(dx, dy)
      if (currentDrag.axis === 'horizontal') {
        event.currentTarget.setPointerCapture(event.pointerId)
        setActionsVisible(true)
        setPhase('tracking')
      }
    }
    if (currentDrag.axis !== 'horizontal') return
    event.preventDefault()
    offset.set(rubberBandAndroidHistoryOffset(currentDrag.startOffset + dx, -actionWidth, 0, currentDrag.dimension))
  }

  const finishPointerGesture = (event: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const currentDrag = drag.current
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (currentDrag.axis !== 'horizontal') return

    event.preventDefault()
    suppressNextClickRef.current = !cancelled
    if (cancelled) {
      settleTo(currentDrag.sourceOpen)
      return
    }

    const samples = appendAndroidHistorySwipeSample(currentDrag.samples, {
      position: event.clientX,
      time: event.timeStamp,
    })
    const velocity = estimateAndroidHistorySwipeVelocity(samples)
    const toggle = shouldToggleAndroidHistorySwipe({
      sourceOpen: currentDrag.sourceOpen,
      startOffset: currentDrag.startOffset,
      offset: offset.get(),
      velocity,
      actionWidth,
    })
    settleTo(toggle ? !currentDrag.sourceOpen : currentDrag.sourceOpen, velocity)
  }

  const runAction = (action: () => void) => {
    settleTo(false)
    action()
  }

  return (
    <div
      className="yachiyo-history-swipe"
      data-swipe-phase={phase}
      data-yachiyo-tab-swipe="block"
      style={
        {
          '--yachiyo-history-action-count': actions.length,
          '--yachiyo-history-action-width': `${actionWidth}px`,
        } as CSSProperties
      }
    >
      <div className="yachiyo-history-actions" aria-hidden={!actionsVisible}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            data-action={action.id}
            disabled={!actionsVisible}
            onClick={() => runAction(action.run)}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <motion.button
        type="button"
        className="yachiyo-history-item"
        data-active={active ? 'true' : 'false'}
        disabled={disabled}
        style={{ x: offset }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={(event) => finishPointerGesture(event, false)}
        onPointerCancel={(event) => finishPointerGesture(event, true)}
        onLostPointerCapture={(event) => finishPointerGesture(event, true)}
        onClick={(event) => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false
            event.preventDefault()
            return
          }
          if (openRef.current || Math.abs(offset.get()) >= 0.5) settleTo(false)
          else onOpen()
        }}
      >
        <span className="yachiyo-history-icon">{loading ? <Loader size={17} /> : <IconMessageCircle size={19} />}</span>
        <span className="yachiyo-history-copy">
          <strong>{record.name}</strong>
          <small>{new Date(record.timestamp).toLocaleString(locale)}</small>
        </span>
        <Badge variant="light" color={record.shared ? 'chatbox-brand' : 'gray'}>
          {record.shared ? t('Agent 可用') : t('聊天')}
        </Badge>
      </motion.button>
    </div>
  )
}
