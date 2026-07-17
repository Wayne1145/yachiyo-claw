import type { AttachmentResolver } from '@shared/context/types'
import storage from '@/storage'

/**
 * Create an AttachmentResolver backed by the app's storage layer
 * Used by orchestration to inject storage dependency into shared buildContext()
 */
export function createAttachmentResolver(): AttachmentResolver {
  return {
    async read(attachmentId: string): Promise<string | null> {
      return storage.getBlob(attachmentId).catch(() => null)
    },
  }
}
