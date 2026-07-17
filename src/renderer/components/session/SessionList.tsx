import type { DragEndEvent } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Text, Tooltip } from '@mantine/core'
import { IconArchive, IconLoader2, IconSearch } from '@tabler/icons-react'
import { useRouterState } from '@tanstack/react-router'
import { type CSSProperties, type MutableRefObject, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { useSessionList } from '@/stores/chatStore'
import { reorderSessions } from '@/stores/sessionActions'
import { useUIStore } from '@/stores/uiStore'
import SessionItem from './SessionItem'

export interface Props {
  sessionListViewportRef: MutableRefObject<HTMLDivElement | null>
}

export default function SessionList(props: Props) {
  const { t } = useTranslation()
  const { sessionMetaList: sortedSessions, fetchNextPage, hasNextPage, isFetchingNextPage } = useSessionList()
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 10,
      },
    }),
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )
  const onDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id))
  }
  const onDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null)
    if (!event.over) {
      return
    }
    if (!sortedSessions) {
      return
    }
    const activeId = String(event.active.id)
    const overId = String(event.over.id)
    if (activeId !== overId) {
      const oldIndex = sortedSessions.findIndex((s) => s.id === activeId)
      const newIndex = sortedSessions.findIndex((s) => s.id === overId)
      if (oldIndex < 0 || newIndex < 0) {
        return
      }
      await reorderSessions(oldIndex, newIndex)
    }
  }
  const onDragCancel = () => {
    setActiveDragId(null)
  }
  const activeDragSession = useMemo(
    () => sortedSessions?.find((session) => session.id === activeDragId),
    [activeDragId, sortedSessions]
  )
  const sortableSessionIds = useMemo(() => sortedSessions?.map((session) => session.id) ?? [], [sortedSessions])
  const routerState = useRouterState()
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])
  const virtuosoComponents = useMemo(
    () =>
      hasNextPage
        ? {
            Footer: () => (
              <Flex justify="center" py="xs">
                <IconLoader2 size={16} className="animate-spin" style={{ color: 'var(--mantine-color-dimmed)' }} />
              </Flex>
            ),
          }
        : {},
    [hasNextPage]
  )

  return (
    <>
      <Flex align="center" py="xs" px="md" gap={'xs'}>
        <Text c="chatbox-tertiary" flex={1}>
          {t('Chat')}
        </Text>

        <Tooltip label={t('Search')} openDelay={1000} withArrow>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={20}
            onClick={() => setOpenSearchDialog(true, true)}
          >
            <IconSearch />
          </ActionIcon>
        </Tooltip>

        <Tooltip label={t('Clear Conversation List')} openDelay={1000} withArrow>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={20}
            onClick={() => NiceModal.show('clear-session-list')}
          >
            <IconArchive />
          </ActionIcon>
        </Tooltip>
      </Flex>

      <DndContext
        modifiers={[restrictToVerticalAxis]}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {sortedSessions && (
          <SortableContext items={sortableSessionIds} strategy={verticalListSortingStrategy}>
            <Virtuoso
              style={{ flex: 1 }}
              data={sortedSessions}
              computeItemKey={(_index, session) => session.id}
              scrollerRef={(ref) => {
                if (ref instanceof HTMLDivElement) {
                  props.sessionListViewportRef.current = ref
                }
              }}
              endReached={onEndReached}
              components={virtuosoComponents}
              itemContent={(_index, session) => (
                <SortableItem id={session.id}>
                  <SessionItem
                    selected={routerState.location.pathname === `/session/${session.id}`}
                    session={session}
                  />
                </SortableItem>
              )}
            />
            <DragOverlay>
              {activeDragSession ? (
                <div className="pointer-events-none">
                  <SessionItem
                    selected={routerState.location.pathname === `/session/${activeDragSession.id}`}
                    session={activeDragSession}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </SortableContext>
        )}
      </DndContext>
    </>
  )
}

function SortableItem(props: { id: string; children?: React.ReactNode }) {
  const { id, children } = props
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  )
}
