import { motion, type MotionValue, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import type { ReactNode } from 'react'
import type { AndroidTabTransitionSnapshot } from './AndroidMainTabPager'

function HeaderTitleLayer({
  title,
  subtitle,
  connected,
  style,
  target,
}: {
  title: string
  subtitle: string
  connected: boolean
  style?: { opacity: MotionValue<number>; transform: MotionValue<string> }
  target?: boolean
}) {
  return (
    <motion.span className="yachiyo-pager-header-title-layer" data-target={target || undefined} style={style}>
      <strong>{title}</strong>
      <span className="yachiyo-mobile-title-meta">
        <i className="yachiyo-connection-indicator" data-connected={connected ? 'true' : 'false'} aria-hidden="true" />
        {subtitle}
      </span>
    </motion.span>
  )
}

export function AndroidPagerHeaderTitle({
  title,
  subtitle,
  targetTitle,
  targetSubtitle,
  connected,
  transition,
  reducedMotion,
}: {
  title: string
  subtitle: string
  targetTitle: string
  targetSubtitle: string
  connected: boolean
  transition?: AndroidTabTransitionSnapshot
  reducedMotion?: boolean
}) {
  const prefersReducedMotion = useReducedMotion()
  const shouldReduceMotion = reducedMotion ?? Boolean(prefersReducedMotion)
  const fallbackProgress = useMotionValue(0)
  const progress = transition?.progress ?? fallbackProgress
  const direction = transition?.direction ?? 1
  const sourceOpacity = useTransform(progress, [0, 0.78, 1], [1, 0.18, 0])
  const targetOpacity = useTransform(progress, [0, 0.22, 1], [0, 0.18, 1])
  const sourceTransform = useTransform(progress, (value) =>
    shouldReduceMotion ? 'translate3d(0, 0, 0)' : `translate3d(${-direction * value * 10}px, 0, 0)`
  )
  const targetTransform = useTransform(progress, (value) =>
    shouldReduceMotion ? 'translate3d(0, 0, 0)' : `translate3d(${direction * (1 - value) * 10}px, 0, 0)`
  )

  return (
    <div className="yachiyo-mobile-title yachiyo-pager-header-title" aria-live="polite">
      <HeaderTitleLayer
        title={title}
        subtitle={subtitle}
        connected={connected}
        style={{ opacity: sourceOpacity, transform: sourceTransform }}
      />
      {transition && (
        <HeaderTitleLayer
          title={targetTitle}
          subtitle={targetSubtitle}
          connected={connected}
          style={{ opacity: targetOpacity, transform: targetTransform }}
          target
        />
      )}
    </div>
  )
}

export function AndroidPagerHeaderActions({
  transition,
  children,
  reducedMotion,
}: {
  transition?: AndroidTabTransitionSnapshot
  children: ReactNode
  reducedMotion?: boolean
}) {
  const prefersReducedMotion = useReducedMotion()
  const shouldReduceMotion = reducedMotion ?? Boolean(prefersReducedMotion)
  const fallbackProgress = useMotionValue(0)
  const progress = transition?.progress ?? fallbackProgress
  const opacity = useTransform(progress, [0, 0.72, 1], [1, 0.35, 0])
  const transform = useTransform(progress, (value) =>
    shouldReduceMotion ? 'translate3d(0, 0, 0)' : `translate3d(${-(transition?.direction ?? 1) * value * 8}px, 0, 0)`
  )
  return (
    <motion.div className="yachiyo-pager-header-actions" style={{ opacity, transform }}>
      {children}
    </motion.div>
  )
}
