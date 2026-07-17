import type { CompactionPoint, Message, MessageContentParts } from '../types'
import type { AttachmentResolver, ContextBuilderOptions } from './types'

const MAX_INLINE_FILE_LINES = 500
const PREVIEW_LINES = 100

/**
 * Build context for AI from messages.
 * Pure function - does not mutate inputs, no side effects.
 */
export async function buildContext(messages: Message[], options: ContextBuilderOptions): Promise<Message[]> {
  const {
    attachmentResolver,
    maxContextMessageCount,
    compactionPoints,
    keepToolCallRounds = 2,
    modelSupportToolUseForFile = false,
  } = options

  if (messages.length === 0) {
    return []
  }

  const completedMessages = messages.filter((m) => !m.generating)

  if (completedMessages.length === 0) {
    return []
  }

  let contextMessages = applyCompaction(completedMessages, compactionPoints, keepToolCallRounds)

  contextMessages = filterErrorMessages(contextMessages)

  if (maxContextMessageCount !== undefined && maxContextMessageCount < Number.MAX_SAFE_INTEGER) {
    contextMessages = applyMessageLimit(contextMessages, maxContextMessageCount)
  }

  contextMessages = await injectAttachments(contextMessages, attachmentResolver, modelSupportToolUseForFile)

  return contextMessages
}

function applyCompaction(
  messages: Message[],
  compactionPoints: CompactionPoint[] | undefined,
  keepToolCallRounds: number
): Message[] {
  const latestCompactionPoint = findLatestCompactionPoint(compactionPoints)

  if (!latestCompactionPoint) {
    return cleanToolCalls(messages, keepToolCallRounds)
  }

  const boundaryIndex = messages.findIndex((m) => m.id === latestCompactionPoint.boundaryMessageId)
  const summaryMessage = messages.find((m) => m.id === latestCompactionPoint.summaryMessageId)

  if (boundaryIndex === -1) {
    return cleanToolCalls(messages, keepToolCallRounds)
  }

  const messagesAfterBoundary = messages.slice(boundaryIndex + 1).filter((m) => !m.isSummary)

  let contextMessages: Message[]
  if (summaryMessage) {
    contextMessages = [summaryMessage, ...messagesAfterBoundary]
  } else {
    contextMessages = messagesAfterBoundary
  }

  const systemMessage = messages.find((m) => m.role === 'system')
  if (systemMessage && !contextMessages.some((m) => m.id === systemMessage.id)) {
    contextMessages = [systemMessage, ...contextMessages]
  }

  return cleanToolCalls(contextMessages, keepToolCallRounds)
}

function findLatestCompactionPoint(compactionPoints?: CompactionPoint[]): CompactionPoint | undefined {
  if (!compactionPoints || compactionPoints.length === 0) {
    return undefined
  }
  return compactionPoints.reduce((latest, current) => {
    return current.createdAt > latest.createdAt ? current : latest
  })
}

function cleanToolCalls(messages: Message[], keepRounds: number): Message[] {
  if (messages.length === 0 || keepRounds < 0) {
    return messages.map((m) => ({ ...m }))
  }

  const roundBoundaryIndex = findRoundBoundaryIndex(messages, keepRounds)

  return messages.map((message, index) => {
    if (index >= roundBoundaryIndex) {
      return { ...message }
    }
    return removeToolCallParts(message)
  })
}

function findRoundBoundaryIndex(messages: Message[], keepRounds: number): number {
  if (keepRounds === 0) {
    return messages.length
  }

  let roundCount = 0
  let inRound = false

  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role

    if (role === 'assistant') {
      inRound = true
    } else if (role === 'user' && inRound) {
      roundCount++
      inRound = false

      if (roundCount >= keepRounds) {
        return i
      }
    }
  }

  return 0
}

function removeToolCallParts(message: Message): Message {
  if (!message.contentParts || message.contentParts.length === 0) {
    return { ...message }
  }

  const filteredParts: MessageContentParts = message.contentParts.filter((part) => part.type !== 'tool-call')

  return {
    ...message,
    contentParts: filteredParts,
  }
}

function filterErrorMessages(messages: Message[]): Message[] {
  return messages.filter((m) => !m.error && !m.errorCode)
}

/**
 * Apply message count limit to context messages.
 * The limit applies to history messages only, preserving the last user message (current input).
 * This is achieved by adding 1 to maxCount since the last message is always the current input.
 */
function applyMessageLimit(messages: Message[], maxCount: number): Message[] {
  const head = messages[0]?.role === 'system' ? messages[0] : undefined
  const workingMsgs = head ? messages.slice(1) : messages

  // maxCount limits history, +1 for the current input (last message)
  const effectiveLimit = maxCount + 1

  const result = workingMsgs.slice(-effectiveLimit).map((m) => ({ ...m }))

  if (head) {
    result.unshift({ ...head })
  }

  return result
}

async function injectAttachments(
  messages: Message[],
  resolver: AttachmentResolver,
  modelSupportToolUseForFile: boolean
): Promise<Message[]> {
  const allStorageKeys = new Set<string>()
  for (const msg of messages) {
    if (msg.files) {
      for (const file of msg.files) {
        if (file.ragMode === 'session-retrieval') {
          continue
        }
        if (file.storageKey) {
          allStorageKeys.add(file.storageKey)
        }
      }
    }
    if (msg.links) {
      for (const link of msg.links) {
        if (link.storageKey) {
          allStorageKeys.add(link.storageKey)
        }
      }
    }
  }

  const attachmentContents = new Map<string, string>()
  if (allStorageKeys.size > 0) {
    const keys = Array.from(allStorageKeys)
    const contents = await Promise.all(keys.map((key) => resolver.read(key).catch(() => null)))
    keys.forEach((key, index) => {
      const content = contents[index]
      if (content !== null) {
        attachmentContents.set(key, content)
      }
    })
  }

  return messages.map((msg) => processMessageAttachments(msg, attachmentContents, modelSupportToolUseForFile))
}

function processMessageAttachments(
  msg: Message,
  attachmentContents: Map<string, string>,
  modelSupportToolUseForFile: boolean
): Message {
  const hasFiles = msg.files && msg.files.length > 0
  const hasLinks = msg.links && msg.links.length > 0

  if (!hasFiles && !hasLinks) {
    return { ...msg }
  }

  let result = { ...msg }
  let attachmentIndex = 1

  if (msg.files) {
    for (const file of msg.files) {
      if (file.ragMode === 'session-retrieval') {
        const attachment = buildRetrievalAttachment({
          index: attachmentIndex++,
          name: file.name,
          key: file.sessionAttachmentId
            ? `session-attachment:${file.sessionAttachmentId}`
            : (file.storageKey ?? file.id),
          status: file.sessionAttachmentIndexStatus ?? file.sessionAttachmentStatus ?? 'pending',
          blockedReason: file.sessionAttachmentBlockedReason,
        })
        result = mergeAttachmentContent(result, attachment)
        continue
      }
      if (file.storageKey) {
        const content = attachmentContents.get(file.storageKey)
        if (content) {
          const attachment = buildAttachment({
            index: attachmentIndex++,
            name: file.name,
            key: file.storageKey,
            content,
            modelSupportToolUseForFile,
          })
          result = mergeAttachmentContent(result, attachment)
        }
      } else if (file.localPath && modelSupportToolUseForFile) {
        const attachment = buildToolOnlyAttachment({
          index: attachmentIndex++,
          name: file.name,
          key: `local:${file.localPath}`,
        })
        result = mergeAttachmentContent(result, attachment)
      }
    }
  }

  if (msg.links) {
    for (const link of msg.links) {
      if (link.storageKey) {
        const content = attachmentContents.get(link.storageKey)
        if (content) {
          const attachment = buildAttachment({
            index: attachmentIndex++,
            name: link.title,
            key: link.storageKey,
            content,
            modelSupportToolUseForFile,
          })
          result = mergeAttachmentContent(result, attachment)
        }
      }
    }
  }

  return result
}

interface AttachmentParams {
  index: number
  name: string
  key: string
  content: string
  modelSupportToolUseForFile: boolean
}

function buildAttachment(params: AttachmentParams): string {
  const { index, name, key, content, modelSupportToolUseForFile } = params
  const lines = content.split('\n')
  const fileLines = lines.length
  const fileSize = content.length

  const shouldTruncate = modelSupportToolUseForFile && fileLines > MAX_INLINE_FILE_LINES

  let prefix = '\n\n<ATTACHMENT_FILE>\n'
  prefix += `<FILE_INDEX>${index}</FILE_INDEX>\n`
  prefix += `<FILE_NAME>${name}</FILE_NAME>\n`
  prefix += `<FILE_KEY>${key}</FILE_KEY>\n`
  prefix += `<FILE_LINES>${fileLines}</FILE_LINES>\n`
  prefix += `<FILE_SIZE>${fileSize} bytes</FILE_SIZE>\n`
  prefix += '<FILE_CONTENT>\n'

  const contentToAdd = shouldTruncate ? lines.slice(0, PREVIEW_LINES).join('\n') : content

  let suffix = '</FILE_CONTENT>\n'
  if (shouldTruncate) {
    suffix += `<TRUNCATED>Content truncated. Showing first ${PREVIEW_LINES} of ${fileLines} lines. Use read_file or search_file_content tool with FILE_KEY="${key}" to read more content.</TRUNCATED>\n`
  }
  suffix += '</ATTACHMENT_FILE>\n'

  return prefix + contentToAdd + '\n' + suffix
}

function buildRetrievalAttachment(params: {
  index: number
  name: string
  key: string
  status: string
  blockedReason?: string
}): string {
  const { index, name, key, status, blockedReason } = params
  let text = '\n\n<ATTACHMENT_FILE>\n'
  text += `<FILE_INDEX>${index}</FILE_INDEX>\n`
  text += `<FILE_NAME>${name}</FILE_NAME>\n`
  text += `<FILE_KEY>${key}</FILE_KEY>\n`
  text += '<FILE_CONTENT>\n'
  text += '</FILE_CONTENT>\n'
  text += '<RETRIEVAL_MODE>session_attachment_rag</RETRIEVAL_MODE>\n'
  text += `<INDEX_STATUS>${status}</INDEX_STATUS>\n`
  if (blockedReason) {
    text += `<BLOCKED_REASON>${blockedReason}</BLOCKED_REASON>\n`
  }
  text += [
    '<SYSTEM_REMINDER>',
    'This uploaded file is indexed for retrieval, not inlined in the conversation. ',
    'For document-specific questions about this file, use query_session_attachment and then ',
    'read_session_attachment_parents before answering. If the user asks something unrelated to the uploaded file, ',
    'answer normally without retrieval.',
    '</SYSTEM_REMINDER>\n',
  ].join('')
  text += '</ATTACHMENT_FILE>\n'
  return text
}

function buildToolOnlyAttachment(params: { index: number; name: string; key: string }): string {
  const { index, name, key } = params
  let text = '\n\n<ATTACHMENT_FILE>\n'
  text += `<FILE_INDEX>${index}</FILE_INDEX>\n`
  text += `<FILE_NAME>${name}</FILE_NAME>\n`
  text += `<FILE_KEY>${key}</FILE_KEY>\n`
  text += '<FILE_CONTENT>\n'
  text += '</FILE_CONTENT>\n'
  text += `<TRUNCATED>Content preview unavailable. Use read_file or search_file_content tool with FILE_KEY="${key}" to inspect this file.</TRUNCATED>\n`
  text += '</ATTACHMENT_FILE>\n'
  return text
}

function mergeAttachmentContent(message: Message, attachmentText: string): Message {
  const contentParts = message.contentParts ?? []
  const existingText = contentParts.find((p) => p.type === 'text')?.text ?? ''
  const newText = existingText + attachmentText

  const nonTextParts = contentParts.filter((p) => p.type !== 'text')
  const textPart = { type: 'text' as const, text: newText }

  return {
    ...message,
    contentParts: [...nonTextParts, textPart],
  }
}
