import { ActionIcon, Box, Button, Flex, Skeleton, Stack, Text, Tooltip } from '@mantine/core'
import type { ImageGeneration } from '@shared/types'
import { IconChevronRight, IconClock, IconPlus } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { HistoryItem } from './HistoryItem'

interface HistoryListFooterContext {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  loadMoreText: string
  onLoadMore: () => void
}

function HistoryListFooter({ context }: { context: HistoryListFooterContext }) {
  if (!context.hasNextPage) return null

  return (
    <div className="px-3 pb-3 pt-2">
      <Button
        variant="subtle"
        size="xs"
        color="gray"
        onClick={context.onLoadMore}
        loading={context.isFetchingNextPage}
        fullWidth
      >
        {context.loadMoreText}
      </Button>
    </div>
  )
}

/* ============================================
   History List Content (shared between desktop/mobile)
   ============================================ */

export interface HistoryListContentProps {
  historyCache: ImageGeneration[]
  historyLoading: boolean
  currentRecordId: string | null
  getModelDisplayName: (record: ImageGeneration) => string
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isMobile?: boolean
  onItemClick: (record: ImageGeneration) => void
  onLoadMore: () => void
  onDelete: (id: string) => void
}

export function HistoryListContent({
  historyCache,
  historyLoading,
  currentRecordId,
  getModelDisplayName,
  hasNextPage,
  isFetchingNextPage,
  isMobile,
  onItemClick,
  onLoadMore,
  onDelete,
}: HistoryListContentProps) {
  const { t } = useTranslation()

  return (
    <Box className="h-full">
      {historyLoading && historyCache.length === 0 && (
        <Stack gap="sm" p={0}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="w-full aspect-square" radius="lg" />
          ))}
        </Stack>
      )}

      {historyCache.length === 0 && !historyLoading && (
        <Flex direction="column" align="center" py="xl" gap="sm" opacity={0.5}>
          <IconClock size={24} />
          <Text size="xs" ta="center">
            {t('No history yet')}
          </Text>
        </Flex>
      )}

      {historyCache.length > 0 && (
        <Virtuoso<ImageGeneration, HistoryListFooterContext>
          style={{ height: '100%' }}
          data={historyCache}
          context={{
            hasNextPage,
            isFetchingNextPage,
            loadMoreText: t('Load More'),
            onLoadMore,
          }}
          itemContent={(_index, record) => (
            <div className="px-3 py-1">
              <HistoryItem
                key={record.id}
                record={record}
                isActive={currentRecordId === record.id}
                isMobile={isMobile}
                modelDisplayName={getModelDisplayName(record)}
                onClick={() => onItemClick(record)}
                onDelete={onDelete}
              />
            </div>
          )}
          endReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              onLoadMore()
            }
          }}
          components={{
            Footer: HistoryListFooter,
          }}
        />
      )}
    </Box>
  )
}

/* ============================================
   Desktop History Panel
   ============================================ */

export interface HistoryPanelProps {
  show: boolean
  width: number
  historyCache: ImageGeneration[]
  historyLoading: boolean
  currentRecordId: string | null
  getModelDisplayName: (record: ImageGeneration) => string
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onItemClick: (record: ImageGeneration) => void
  onLoadMore: () => void
  onNewCreation: () => void
  onClose: () => void
  onDelete: (id: string) => void
}

export function HistoryPanel({
  show,
  width,
  historyCache,
  historyLoading,
  currentRecordId,
  getModelDisplayName,
  hasNextPage,
  isFetchingNextPage,
  onItemClick,
  onLoadMore,
  onNewCreation,
  onClose,
  onDelete,
}: HistoryPanelProps) {
  const { t } = useTranslation()

  return (
    <Box
      w={show ? width : 0}
      h="100%"
      className="border-0 border-l border-solid border-[var(--chatbox-border-primary)] bg-[var(--chatbox-background-primary)] transition-all duration-300 ease-in-out overflow-hidden shrink-0"
    >
      <Flex direction="column" h="100%" w={width}>
        <Flex align="center" justify="space-between" px="xs" py="xs" className="">
          <Text size="sm" fw={600}>
            {t('History')}
          </Text>
          <Flex gap={4}>
            <Tooltip label={t('New Creation')}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={onNewCreation}>
                <IconPlus size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('Close')}>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose}>
                <IconChevronRight size={14} />
              </ActionIcon>
            </Tooltip>
          </Flex>
        </Flex>

        <Box flex={1}>
          <HistoryListContent
            historyCache={historyCache}
            historyLoading={historyLoading}
            currentRecordId={currentRecordId}
            getModelDisplayName={getModelDisplayName}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onItemClick={onItemClick}
            onLoadMore={onLoadMore}
            onDelete={onDelete}
          />
        </Box>
      </Flex>
    </Box>
  )
}
