import { Button, Text } from '@mantine/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'

/** Dismissal, replacement, and unmount all cancel the pending operation. */
export function useSettingsConfirmation() {
  const { t } = useTranslation()
  const pending = useRef<((approved: boolean) => void) | undefined>()
  const [message, setMessage] = useState('')
  const finish = useCallback((approved: boolean) => {
    const resolve = pending.current
    pending.current = undefined
    setMessage('')
    resolve?.(approved)
  }, [])
  const confirm = useCallback(
    (text: string) =>
      new Promise<boolean>((resolve) => {
        pending.current?.(false)
        pending.current = resolve
        setMessage(text)
      }),
    []
  )
  useEffect(
    () => () => {
      pending.current?.(false)
      pending.current = undefined
    },
    []
  )
  const confirmation = (
    <AdaptiveModal
      opened={Boolean(message)}
      onClose={() => finish(false)}
      title={t('Confirm')}
      className="settings-surface"
    >
      <Text size="sm">{message}</Text>
      <AdaptiveModal.Actions>
        <Button variant="default" onClick={() => finish(false)}>
          {t('Cancel')}
        </Button>
        <Button color="red" onClick={() => finish(true)}>
          {t('Confirm')}
        </Button>
      </AdaptiveModal.Actions>
    </AdaptiveModal>
  )
  return { confirm, confirmation }
}
