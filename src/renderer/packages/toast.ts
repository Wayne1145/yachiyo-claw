import { toast } from 'sonner'
import { translateTexts } from '@/packages/translation'
import { settingsStore } from '@/stores/settingsStore'

type ErrorToastMessage = Parameters<typeof toast.error>[0]
type ErrorToastOptions = Parameters<typeof toast.error>[1]

function isTranslatableMessage(message: ErrorToastMessage): message is string {
  return typeof message === 'string' && message.trim().length > 0
}

export function toastError(message: ErrorToastMessage, options?: ErrorToastOptions): void {
  const id = options?.id ?? `toast-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  toast.error(message, { ...options, id })

  if (!isTranslatableMessage(message)) {
    return
  }

  const state = settingsStore.getState()
  if (state.skills?.translationEnabled === false || state.language === 'en') {
    return
  }

  const targetLanguage = state.language
  void translateTexts([message], targetLanguage)
    .then(([translated]) => {
      if (!translated || translated === message) {
        return
      }

      toast.error(message, {
        ...options,
        id,
        description: translated,
      })
    })
    .catch(() => {
      return
    })
}
