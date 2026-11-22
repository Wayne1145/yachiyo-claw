import type { CodingProjectRecord } from '@shared/types'
import { getBuildTargetProfile } from '@shared/types'
import { IconArrowRight, IconFolderCode } from '@tabler/icons-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { messageProjectPreviews } from '@/mobile/message-project-previews'
import { useCodingBuildRuns } from '@/stores/codingProjectStore'
import { useTaskSessionRecord } from '@/stores/taskSessionStore'
import { ProjectPreviewCard } from './ProjectPreviewCard'

export function CodingProjectSummary({
  project,
  onShowRuns,
}: {
  project: CodingProjectRecord
  onShowRuns: () => void
}) {
  const { t } = useTranslation()
  const { data: session } = useTaskSessionRecord(project.taskId)
  const { data: builds } = useCodingBuildRuns(project.id)
  const chatPreview = useMemo(() => {
    const messages = session?.messages || []
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].generating) continue
      const preview = messageProjectPreviews(messages[index]).at(-1)
      if (preview) return preview
    }
  }, [session?.messages])
  const latest = builds?.reduce((a, b) => (a.startedAt > b.startedAt ? a : b), builds[0])
  const previewRun = builds
    ?.filter((run) => run.kind === 'preview' && run.preview && (run.state === 'queued' || run.state === 'running'))
    .sort((a, b) => b.startedAt - a.startedAt)[0]?.preview
  const preview = previewRun ? { url: previewRun.url, previewId: previewRun.id } : chatPreview
  return (
    <aside className="coding-project-summary" aria-label={String(t('项目概览'))}>
      <div className="coding-project-summary-heading">
        <IconFolderCode size={20} aria-hidden="true" />
        <strong>{t('项目概览')}</strong>
        <button type="button" onClick={onShowRuns}>
          {t('运行记录')}
          <IconArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
      {preview ? (
        <ProjectPreviewCard name={project.name} preview={preview} />
      ) : (
        <p>
          {getBuildTargetProfile(project.targetId).label} · {latest ? t(latest.state) : t('尚无运行记录')}
        </p>
      )}
    </aside>
  )
}
