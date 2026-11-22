import type { Message } from '@shared/types'
import { IconArrowUpRight, IconAppWindow } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { localPreviewUrl, messageProjectPreviews, type ProjectPreview } from '@/mobile/message-project-previews'
import platform from '@/platform'
import './project-preview-card.css'

export function ProjectPreviewCard({ preview, name }: { preview: ProjectPreview; name?: string }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const url = localPreviewUrl(preview.url)
  if (!url) return null
  const open = async () => {
    if (busy) return
    setBusy(true)
    setError(false)
    try {
      // Native preview registrations are persistent. Restore a historical link only on an explicit tap.
      if (!platform.openWorkspacePreview) throw new Error('preview_unavailable')
      if (preview.previewId && (await platform.openWorkspacePreview(preview.previewId).catch(() => null))?.success)
        return
      const registered = await platform.registerWorkspacePreview?.({
        port: Number(url.port || 80),
        path: url.pathname + url.search + url.hash,
      })
      if (!registered?.success || !registered.id || !(await platform.openWorkspacePreview(registered.id)).success)
        throw new Error('preview_unavailable')
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="yachiyo-project-delivery">
      <button
        type="button"
        className="yachiyo-project-preview-card"
        disabled={busy}
        aria-busy={busy}
        onClick={() => void open()}
      >
        <span className="yachiyo-project-preview-mark" aria-hidden="true">
          <IconAppWindow size={24} stroke={1.6} />
        </span>
        <span className="yachiyo-project-preview-copy">
          <strong>{name || preview.title || t('本地项目预览')}</strong>
          <small dir="ltr">
            {url.host}
            {url.pathname === '/' ? '' : url.pathname}
          </small>
        </span>
        <span className="yachiyo-project-preview-action">
          {t('打开预览')}
          <IconArrowUpRight size={16} aria-hidden="true" />
        </span>
      </button>
      {error && <p role="status">{t('无法打开项目预览，请检查本地服务后重试。')}</p>}
    </div>
  )
}

export function MessageProjectCards({ message, sessionName }: { message: Message; sessionName?: string }) {
  const previews = useMemo(
    () => (message.generating ? [] : messageProjectPreviews(message)),
    [message.generating, message.contentParts, message.role]
  )
  return (
    <>
      {previews.map((preview) => (
        <ProjectPreviewCard key={preview.url} preview={preview} name={preview.title || sessionName} />
      ))}
    </>
  )
}
