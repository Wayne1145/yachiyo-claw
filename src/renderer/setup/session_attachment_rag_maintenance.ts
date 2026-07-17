import type { Session, SessionAttachmentRagMaintenanceResult } from '@shared/types'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import { getSession, listSessionsMeta } from '@/stores/chatStore'
import { SESSION_ATTACHMENT_RAG_LOG_PREFIX } from '../../shared/session-attachment-rag/logging'

const log = getLogger('session-attachment-rag-maintenance')
const ORPHAN_CLEANUP_INTERVAL_MS = 30 * 60 * 1000

let maintenanceStarted = false

type SessionAttachmentRagMaintenanceTask = {
  name: string
  intervalMs: number
  run: () => Promise<SessionAttachmentRagMaintenanceResult>
}

function collectSessionMessageIds(session: Session): string[] {
  const ids = new Set<string>()

  for (const message of session.messages) {
    ids.add(message.id)
  }

  for (const thread of session.threads ?? []) {
    for (const message of thread.messages) {
      ids.add(message.id)
    }
  }

  for (const fork of Object.values(session.messageForksHash ?? {})) {
    for (const list of fork.lists) {
      for (const message of list.messages) {
        ids.add(message.id)
      }
    }
  }

  return Array.from(ids)
}

async function collectMaintenanceScope() {
  if (platform.type !== 'desktop') {
    return {
      sessionIds: [],
      messageIds: [],
    }
  }

  const sessionMetas = await listSessionsMeta()
  const sessionIds = sessionMetas.map((session) => session.id)
  const messageIds = new Set<string>()

  for (const sessionMeta of sessionMetas) {
    const session = await getSession(sessionMeta.id)
    if (!session) {
      continue
    }
    for (const messageId of collectSessionMessageIds(session)) {
      messageIds.add(messageId)
    }
  }

  return {
    sessionIds,
    messageIds: Array.from(messageIds),
  }
}

const maintenanceTasks: SessionAttachmentRagMaintenanceTask[] = [
  {
    name: 'full-maintenance-pass',
    intervalMs: ORPHAN_CLEANUP_INTERVAL_MS,
    run: async () => {
      const scope = await collectMaintenanceScope()
      const result = await platform.getSessionAttachmentRagController().runMaintenance(scope)

      if (result.interruptedFailedCount > 0 || result.canceledPurgedCount > 0 || result.orphanDeletedIds.length > 0) {
        log.info(
          `${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [MAINTENANCE] Completed pass: interruptedFailed=${result.interruptedFailedCount}, canceledPurged=${result.canceledPurgedCount}, orphanDeleted=${result.orphanDeletedIds.length}`
        )
      }

      return result
    },
  },
]

async function runMaintenanceTask(task: SessionAttachmentRagMaintenanceTask) {
  try {
    await task.run()
  } catch (error) {
    log.warn(`${SESSION_ATTACHMENT_RAG_LOG_PREFIX} [MAINTENANCE] Failed task ${task.name}:`, error)
  }
}

export async function runSessionAttachmentRagMaintenancePass() {
  const results = await Promise.all(maintenanceTasks.map((task) => task.run()))
  return (
    results.at(-1) ?? {
      interruptedFailedCount: 0,
      canceledPurgedCount: 0,
      orphanDeletedIds: [],
    }
  )
}

export function initSessionAttachmentRagMaintenance() {
  if (maintenanceStarted || platform.type !== 'desktop') {
    return
  }

  maintenanceStarted = true

  void runSessionAttachmentRagMaintenancePass()
  for (const task of maintenanceTasks) {
    setInterval(() => {
      void runMaintenanceTask(task)
    }, task.intervalMs)
  }
}
