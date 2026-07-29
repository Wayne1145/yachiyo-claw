import { motion, type MotionValue } from 'framer-motion'
import type { CSSProperties } from 'react'
import { useBlob } from '@/hooks/useBlob'
import { useSession } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTaskSessionRecord } from '@/stores/taskSessionStore'
import { blobToDataUrl } from '@/routes/image-creator/-components/constants'
import { resolveApprovedCharacterTint, resolveFlowGlassEnvironment } from './flow-glass-environment'

type FlowGlassStyle = CSSProperties & {
  '--flow-character-tint'?: string
  '--flow-custom-background-image'?: string
}

export function AndroidFlowGlassEnvironment({
  pathname,
  transitionOpacity,
}: {
  pathname: string
  transitionOpacity?: MotionValue<number>
}) {
  const sessionId = pathname.match(/^\/session\/([^/]+)$/)?.[1] ?? null
  const taskId = pathname.match(/^\/task\/([^/]+)$/)?.[1] ?? null
  const { data: task } = useTaskSessionRecord(taskId)
  const { session } = useSession(sessionId || task?.linkedSessionId || null)
  const globalBackgroundImageKey = useSettingsStore((state) => state.backgroundImageKey)
  const context = resolveFlowGlassEnvironment(pathname)
  const preservesConversationBackground = context === 'chat' && (pathname === '/' || Boolean(sessionId))
  const conversationBackground = preservesConversationBackground ? session?.backgroundImage : undefined
  const storedKey =
    conversationBackground?.type === 'storage-key'
      ? conversationBackground.storageKey
      : conversationBackground?.type === 'url'
        ? undefined
        : preservesConversationBackground
          ? globalBackgroundImageKey
          : undefined
  const { data: storedBackground } = useBlob(storedKey)
  const customImageUrl =
    conversationBackground?.type === 'url'
      ? conversationBackground.url
      : storedKey && storedBackground
        ? blobToDataUrl(storedBackground)
        : undefined
  const tintKey = session?.assistantAvatarKey || session?.picUrl || session?.id
  const style: FlowGlassStyle = {
    '--flow-character-tint': resolveApprovedCharacterTint(tintKey),
    ...(customImageUrl
      ? {
          backgroundImage: `url(${JSON.stringify(customImageUrl)})`,
          '--flow-custom-background-image': `url(${JSON.stringify(customImageUrl)})`,
        }
      : {}),
  }

  return (
    <motion.div
      className={`yachiyo-flow-environment${transitionOpacity ? ' yachiyo-flow-environment-target' : ''}`}
      data-context={context}
      data-custom-background={customImageUrl ? 'true' : 'false'}
      style={{ ...style, opacity: transitionOpacity }}
      aria-hidden="true"
    >
      <div className="yachiyo-flow-environment-image" />
      <div className="yachiyo-flow-environment-character-tint" />
      <div className="yachiyo-flow-environment-scrim" />
    </motion.div>
  )
}

export function FlowGlassFilterDefinitions() {
  return (
    <svg className="yachiyo-flow-filter-definitions" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <FlowDisplacementFilter
          id="yachiyo-flow-nav-refraction"
          href="/liquid-glass/optics/compact-capsule-normal.png"
          scale={3.2}
        />
        <FlowDisplacementFilter
          id="yachiyo-flow-control-refraction"
          href="/liquid-glass/optics/compact-circle-normal.png"
          scale={2.4}
        />
        <FlowDisplacementFilter
          id="yachiyo-flow-composer-refraction"
          href="/liquid-glass/optics/compact-rounded-rect-normal.png"
          scale={2.8}
        />
        <FlowDisplacementFilter
          id="yachiyo-flow-popover-refraction"
          href="/liquid-glass/optics/compact-rounded-rect-normal.png"
          scale={2.2}
        />
      </defs>
    </svg>
  )
}

function FlowDisplacementFilter({ id, href, scale }: { id: string; href: string; scale: number }) {
  return (
    <filter id={id} x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
      <feImage href={href} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="normalMap" />
      <feDisplacementMap
        in="SourceGraphic"
        in2="normalMap"
        scale={scale}
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  )
}
