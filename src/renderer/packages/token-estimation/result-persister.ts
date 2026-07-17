import type { Message, MessageFile, MessageLink, TokenCacheKey, TokenCountMap } from '@shared/types'
import { getLogger } from '@/lib/utils'
import * as chatStore from '@/stores/chatStore'
import queryClient from '@/stores/queryClient'
import { getTaskSession, TASK_SESSION_QUERY_KEY, updateTaskSession } from '@/stores/taskSessionStore'
import type { AttachmentType, ContentMode, TaskResult, TokenizerType } from './types'

const log = getLogger('token-estimation:persister')

interface AttachmentUpdate {
  id: string
  type: AttachmentType
  tokenCountMap?: Partial<Record<TokenCacheKey, number>>
  tokenCalculatedAt?: Partial<Record<TokenCacheKey, number>>
  lineCount?: number
  byteLength?: number
}

interface PendingUpdate {
  sessionId: string
  messageId: string
  updates: {
    tokenCountMap?: Partial<Record<TokenizerType, number>>
    tokenCalculatedAt?: Partial<Record<TokenizerType, number>>
    attachments?: AttachmentUpdate[]
  }
}

function applyAttachmentUpdate<T extends MessageFile | MessageLink>(attachment: T, update: AttachmentUpdate): T {
  return {
    ...attachment,
    tokenCountMap: {
      ...attachment.tokenCountMap,
      ...update.tokenCountMap,
    } as TokenCountMap,
    tokenCalculatedAt: {
      ...attachment.tokenCalculatedAt,
      ...update.tokenCalculatedAt,
    },
    lineCount: update.lineCount ?? attachment.lineCount,
    byteLength: update.byteLength ?? attachment.byteLength,
  }
}

function applyUpdates(msg: Message, updates: PendingUpdate['updates']): Message {
  const updated = { ...msg }

  if (updates.tokenCountMap) {
    updated.tokenCountMap = {
      ...updated.tokenCountMap,
      ...updates.tokenCountMap,
    } as TokenCountMap
  }
  if (updates.tokenCalculatedAt) {
    updated.tokenCalculatedAt = {
      ...updated.tokenCalculatedAt,
      ...updates.tokenCalculatedAt,
    }
  }

  if (updates.attachments) {
    for (const attUpdate of updates.attachments) {
      if (attUpdate.type === 'file' && updated.files) {
        updated.files = updated.files.map((f) => (f.id === attUpdate.id ? applyAttachmentUpdate(f, attUpdate) : f))
      }
      if (attUpdate.type === 'link' && updated.links) {
        updated.links = updated.links.map((l) => (l.id === attUpdate.id ? applyAttachmentUpdate(l, attUpdate) : l))
      }
    }
  }

  return updated
}

function buildCacheKey(tokenizerType: TokenizerType, contentMode?: ContentMode): TokenCacheKey {
  if (contentMode === 'preview') {
    return `${tokenizerType}_preview` as TokenCacheKey
  }
  return tokenizerType as TokenCacheKey
}

class ResultPersister {
  private pendingUpdates = new Map<string, PendingUpdate>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private throttleMs = 1000
  private lastFlushTime = 0
  private listeners = new Set<() => void>()
  private flushPromise: Promise<void> | null = null

  addResult(result: NonNullable<TaskResult['result']>): void {
    const key = `${result.sessionId}:${result.messageId}`
    let pending = this.pendingUpdates.get(key)

    if (!pending) {
      pending = {
        sessionId: result.sessionId,
        messageId: result.messageId,
        updates: {},
      }
      this.pendingUpdates.set(key, pending)
    }

    if (result.type === 'message-text') {
      pending.updates.tokenCountMap = {
        ...pending.updates.tokenCountMap,
        [result.tokenizerType]: result.tokens,
      }
      pending.updates.tokenCalculatedAt = {
        ...pending.updates.tokenCalculatedAt,
        [result.tokenizerType]: result.calculatedAt,
      }
      log.debug('Result added (message-text)', { messageId: result.messageId, tokens: result.tokens })
    } else {
      const cacheKey = buildCacheKey(result.tokenizerType, result.contentMode)

      if (!pending.updates.attachments) {
        pending.updates.attachments = []
      }

      const existingAtt = pending.updates.attachments.find((a) => a.id === result.attachmentId)
      if (existingAtt) {
        existingAtt.tokenCountMap = {
          ...existingAtt.tokenCountMap,
          [cacheKey]: result.tokens,
        }
        existingAtt.tokenCalculatedAt = {
          ...existingAtt.tokenCalculatedAt,
          [cacheKey]: result.calculatedAt,
        }
        existingAtt.lineCount = result.lineCount
        existingAtt.byteLength = result.byteLength
      } else {
        pending.updates.attachments.push({
          id: result.attachmentId!,
          type: result.attachmentType!,
          tokenCountMap: { [cacheKey]: result.tokens },
          tokenCalculatedAt: { [cacheKey]: result.calculatedAt },
          lineCount: result.lineCount,
          byteLength: result.byteLength,
        })
      }
      log.debug('Result added (attachment)', { attachmentId: result.attachmentId, tokens: result.tokens })
    }

    this.scheduleFlush()
  }

  getPendingCount(): number {
    return this.pendingUpdates.size
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (this.flushPromise) {
      await this.flushPromise
    }

    this.flushPromise = this.flush()
    await this.flushPromise
    this.flushPromise = null
  }

  cancel(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pendingUpdates.clear()
  }

  private scheduleFlush(): void {
    const now = Date.now()
    const timeSinceLastFlush = now - this.lastFlushTime

    if (timeSinceLastFlush >= this.throttleMs) {
      // 距离上次 flush 已超过 throttleMs，立即 flush
      this.doFlush()
    } else if (!this.flushTimer) {
      // 安排在剩余时间后 flush
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        this.doFlush()
      }, this.throttleMs - timeSinceLastFlush)
    }
    // 如果已有计时器，不做任何事（throttle 行为）
  }

  private doFlush(): void {
    this.lastFlushTime = Date.now()
    this.flushPromise = this.flush()
    this.flushPromise.finally(() => {
      this.flushPromise = null
    })
  }

  private async flush(): Promise<void> {
    const updates = Array.from(this.pendingUpdates.values())
    this.pendingUpdates.clear()

    if (updates.length === 0) return

    log.debug('Flush started', { updateCount: updates.length })

    const bySession = new Map<string, PendingUpdate[]>()
    for (const update of updates) {
      const list = bySession.get(update.sessionId) || []
      list.push(update)
      bySession.set(update.sessionId, list)
    }

    for (const [sessionId, sessionUpdates] of bySession) {
      try {
        await chatStore.updateMessages(sessionId, (messages) => applyUpdatesToMessages(messages, sessionUpdates))

        log.debug('Flush completed for session', { sessionId, updateCount: sessionUpdates.length })
      } catch (error) {
        const flushedTaskSession = await this.flushTaskSessionUpdates(sessionId, sessionUpdates)
        if (flushedTaskSession) {
          log.debug('Flush completed for task session', { sessionId, updateCount: sessionUpdates.length })
          continue
        }

        log.error('Failed to flush updates for session', { sessionId, error })
      }
    }

    this.notifyListeners()
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ResultPersister] Listener error:', error)
      }
    }
  }

  private async flushTaskSessionUpdates(sessionId: string, sessionUpdates: PendingUpdate[]): Promise<boolean> {
    const taskSession = await getTaskSession(sessionId)
    if (!taskSession) {
      return false
    }

    const messages = applyUpdatesToMessages(taskSession.messages, sessionUpdates)
    const updated = await updateTaskSession(sessionId, { messages })
    if (updated) {
      queryClient.setQueryData([TASK_SESSION_QUERY_KEY, sessionId], updated)
    } else {
      queryClient.setQueryData([TASK_SESSION_QUERY_KEY, sessionId], { ...taskSession, messages })
    }

    return true
  }
}

function applyUpdatesToMessages(messages: Message[] | null | undefined, sessionUpdates: PendingUpdate[]): Message[] {
  if (!messages) return []
  return messages.map((msg) => {
    const update = sessionUpdates.find((u) => u.messageId === msg.id)
    if (!update) return msg
    return applyUpdates(msg, update.updates)
  })
}

export const resultPersister = new ResultPersister()

export { ResultPersister }
export type { PendingUpdate, AttachmentUpdate }
