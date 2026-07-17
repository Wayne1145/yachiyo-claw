import { Alert, Button, Flex, Group, ScrollArea, Stack, Text, Tooltip } from '@mantine/core'
import {
  KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE_LABEL,
  KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR,
} from '@shared/knowledge-base'
import { ChatboxAIAPIError } from '@shared/models/errors'
import type { KnowledgeBaseFile } from '@shared/types'
import { formatFileSize } from '@shared/utils'
import { IconAlertTriangle, IconFile, IconInfoCircle, IconRefresh } from '@tabler/icons-react'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Modal } from '@/components/layout/Overlay'
import { toastError } from '@/packages/toast'
import platform from '@/platform'

/**
 * Parse error message to extract user-friendly message
 * Handles JSON error responses and uses i18nKey from ChatboxAIAPIError.codeNameMap
 */
function parseErrorMessage(errorMessage: string, t: TFunction): string {
  if (errorMessage === KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR) {
    return t('Parsed document content must be {{limit}} or smaller.', {
      limit: KNOWLEDGE_BASE_MAX_PARSED_CONTENT_SIZE_LABEL,
    })
  }

  try {
    // Find JSON part in the message
    const jsonMatch = errorMessage.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const jsonStr = jsonMatch[0]
      const parsed = JSON.parse(jsonStr)
      const errorCode = parsed.error?.code

      // Try to get i18nKey from ChatboxAIAPIError.codeNameMap
      if (errorCode && ChatboxAIAPIError.codeNameMap[errorCode]) {
        return t(ChatboxAIAPIError.codeNameMap[errorCode].i18nKey)
      }

      // Fallback to detail or title
      if (parsed.error?.detail) {
        return parsed.error.detail
      }
      if (parsed.error?.title) {
        return parsed.error.title
      }
    }
  } catch {
    // JSON parsing failed, return original message
  }
  return t(errorMessage)
}

interface RemoteRetryModalProps {
  opened: boolean
  onClose: () => void
  failedFiles: KnowledgeBaseFile[]
  onSuccess: () => void
}

export function RemoteRetryModal({ opened, onClose, failedFiles, onSuccess }: RemoteRetryModalProps) {
  const { t } = useTranslation()
  const [retryingIds, setRetryingIds] = useState<number[]>([])
  const [retryingAll, setRetryingAll] = useState(false)

  // Filter files that failed with local parsing (can be retried with server parsing)
  const localFailedFiles = useMemo(
    () => failedFiles.filter((f) => !f.parsed_remotely && f.error !== KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR),
    [failedFiles]
  )

  const handleRetry = async (fileId: number, filename: string) => {
    setRetryingIds((prev) => [...prev, fileId])
    try {
      const controller = platform.getKnowledgeBaseController()
      await controller.retryFile(fileId, true) // useRemoteParsing = true
      toast.success(t('File {{filename}} queued for server parsing', { filename }))
      onSuccess()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      toastError(t('Failed to retry {{filename}}: {{error}}', { filename, error: errorMessage }))
    } finally {
      setRetryingIds((prev) => prev.filter((id) => id !== fileId))
    }
  }

  const handleRetryAll = async () => {
    setRetryingAll(true)
    try {
      const controller = platform.getKnowledgeBaseController()
      // Only retry files that failed with local parsing
      const results = await Promise.allSettled(localFailedFiles.map((f) => controller.retryFile(f.id, true)))

      const successCount = results.filter((r) => r.status === 'fulfilled').length
      const failCount = results.filter((r) => r.status === 'rejected').length

      if (successCount > 0) {
        toast.success(t('{{count}} file(s) queued for server parsing', { count: successCount }))
      }
      if (failCount > 0) {
        toastError(t('{{count}} file(s) failed to queue', { count: failCount }))
      }

      onSuccess()
      onClose()
    } finally {
      setRetryingAll(false)
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t('Retry with Server Parsing')} size="lg" centered>
      <Stack gap="md">
        {/* Warning alert */}
        <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
          {t('Server parsing will consume compute credits. Please be cautious with large files.')}
        </Alert>

        {/* Action bar */}
        <Group justify="flex-end">
          <Button
            leftSection={<IconRefresh size={14} />}
            onClick={handleRetryAll}
            loading={retryingAll}
            disabled={localFailedFiles.length === 0}
          >
            {t('Retry All')} ({localFailedFiles.length})
          </Button>
        </Group>

        {/* File list */}
        <ScrollArea h={300}>
          <Stack gap="xs">
            {failedFiles.map((file) => {
              const isServerFailed = Boolean(file.parsed_remotely)
              const isRetryable = !isServerFailed && file.error !== KNOWLEDGE_BASE_PARSED_CONTENT_TOO_LARGE_ERROR
              return (
                <Flex
                  key={file.id}
                  justify="space-between"
                  align="center"
                  p="xs"
                  className="rounded"
                  bg="var(--mantine-color-gray-0)"
                >
                  <Flex gap="sm" align="center" style={{ flex: 1, minWidth: 0 }}>
                    <IconFile size={16} className="flex-shrink-0" />
                    <Text size="sm" lineClamp={1} style={{ flex: 1 }}>
                      {file.filename}
                    </Text>
                    <Text size="xs" c="dimmed" className="flex-shrink-0">
                      {formatFileSize(file.file_size)}
                    </Text>
                    {/* Error info tooltip */}
                    {file.error && (
                      <Tooltip label={parseErrorMessage(file.error, t)} multiline w={300} withArrow position="top">
                        <IconInfoCircle
                          size={14}
                          color="var(--mantine-color-red-6)"
                          className="flex-shrink-0 cursor-help"
                        />
                      </Tooltip>
                    )}
                  </Flex>
                  {!isRetryable ? (
                    <Text size="xs" c="dimmed" ml="sm">
                      {t('No retry available')}
                    </Text>
                  ) : (
                    <Button
                      size="xs"
                      variant="light"
                      ml="sm"
                      onClick={() => handleRetry(file.id, file.filename)}
                      loading={retryingIds.includes(file.id)}
                      disabled={retryingAll}
                    >
                      {t('Retry')}
                    </Button>
                  )}
                </Flex>
              )
            })}
          </Stack>
        </ScrollArea>
      </Stack>
    </Modal>
  )
}
