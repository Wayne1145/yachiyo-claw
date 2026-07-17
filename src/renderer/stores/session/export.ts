import type { ExportChatFormat, ExportChatScope } from '@shared/types'
import * as chatStore from '../chatStore'
import { exportChat } from '../sessionHelpers'

export async function exportSessionChat(sessionId: string, content: ExportChatScope, format: ExportChatFormat) {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return
  }
  await exportChat(session, content, format)
}
