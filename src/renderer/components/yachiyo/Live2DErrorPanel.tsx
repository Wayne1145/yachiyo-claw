import { IconCopy, IconRefresh } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Live2DUserError } from '@/mobile/live2d-errors'

export function Live2DErrorPanel({ error, onRetry }: { error: Live2DUserError; onRetry?: () => void }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const technicalDetail = useMemo(
    () =>
      [
        `code=${error.code}`,
        `phase=${error.phase}`,
        error.resource ? `resource=${error.resource}` : '',
        error.httpStatus ? `httpStatus=${error.httpStatus}` : '',
        error.technicalDetail || '',
      ]
        .filter(Boolean)
        .join('\n'),
    [error]
  )

  const copyDetail = async () => {
    try {
      await navigator.clipboard.writeText(technicalDetail)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="yachiyo-live2d-error-panel" role="alert" data-code={error.code}>
      <strong>{t(error.title)}</strong>
      <p>{t(error.explanation)}</p>
      <p className="yachiyo-live2d-error-resolution">{t(error.resolution)}</p>
      <code>{error.code}</code>
      <div className="yachiyo-live2d-error-actions">
        {onRetry && error.retryable && (
          <button type="button" onClick={onRetry}>
            <IconRefresh size={16} />
            {t('重试')}
          </button>
        )}
        <details>
          <summary>{t('技术详情')}</summary>
          <pre>{technicalDetail}</pre>
          <button type="button" onClick={() => void copyDetail()}>
            <IconCopy size={16} />
            {copied ? t('已复制') : t('复制错误详情')}
          </button>
        </details>
      </div>
    </section>
  )
}
