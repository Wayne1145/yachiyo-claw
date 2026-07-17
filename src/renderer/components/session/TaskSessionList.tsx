import { Flex, Text } from '@mantine/core'
import type { TaskSession } from '@shared/types'
import { IconFolder } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { memo } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { taskSessionStore, useCurrentTaskId, useTaskSessionHistory } from '@/stores/taskSessionStore'
import { useUIStore } from '@/stores/uiStore'
import { TASK_DEFAULT_DIRECTORY } from '@shared/constants/task'
import { ScalableIcon } from '../common/ScalableIcon'

export default function TaskSessionList() {
  const navigate = useNavigate()
  const { data, fetchNextPage, hasNextPage } = useTaskSessionHistory()
  const currentTaskId = useCurrentTaskId()
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const isSmallScreen = useIsSmallScreen()

  const allSessions = data?.pages.flatMap((p) => p.items) ?? []

  return (
    <Virtuoso
      style={{ flex: 1 }}
      data={allSessions}
      endReached={() => {
        if (hasNextPage) void fetchNextPage()
      }}
      itemContent={(_index, session) => (
        <TaskSessionItem
          session={session}
          selected={session.id === currentTaskId}
          onClick={() => {
            taskSessionStore.getState().setCurrentTaskId(session.id)
            navigate({ to: '/task/$taskId', params: { taskId: session.id } })
            if (isSmallScreen) setShowSidebar(false)
          }}
        />
      )}
    />
  )
}

interface TaskSessionItemProps {
  session: TaskSession
  selected: boolean
  onClick: () => void
}

const TaskSessionItem = memo(function TaskSessionItem({ session, selected, onClick }: TaskSessionItemProps) {
  const isSmallScreen = useIsSmallScreen()
  const showDir = session.workingDirectory !== TASK_DEFAULT_DIRECTORY
  const truncatedDir = !showDir
    ? ''
    : session.workingDirectory.length > 30
      ? `...${session.workingDirectory.slice(-27)}`
      : session.workingDirectory

  return (
    <Flex
      align="center"
      className={clsx(
        'cursor-pointer rounded-sm',
        isSmallScreen
          ? ''
          : selected
            ? 'bg-chatbox-background-brand-secondary'
            : 'hover:bg-chatbox-background-gray-secondary'
      )}
      mx="xs"
      px="xs"
      py={10}
      gap={10}
      onClick={onClick}
    >
      <ScalableIcon
        icon={IconFolder}
        size={20}
        className={selected ? 'text-[var(--mantine-color-blue-filled)]' : 'text-[var(--mantine-color-dimmed)]'}
      />
      <Flex direction="column" flex={1} gap={0} style={{ overflow: 'hidden' }}>
        <Text span lineClamp={1} c={selected ? 'chatbox-brand' : 'chatbox-primary'} size="sm">
          {session.name}
        </Text>
        {showDir && (
          <Text span lineClamp={1} c="dimmed" size="xs" className="font-mono">
            {truncatedDir}
          </Text>
        )}
      </Flex>
    </Flex>
  )
})
