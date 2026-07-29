import { motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { createContext, type ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'
import type { AndroidTabTransitionSnapshot } from './AndroidMainTabPager'
import { useAndroidPagerPagePresentation } from './android-pager-page-presentation'

const AndroidSharedChromeHostContext = createContext<HTMLElement | null>(null)

export function AndroidSharedChromeHostProvider({ host, children }: { host: HTMLElement | null; children: ReactNode }) {
  return <AndroidSharedChromeHostContext.Provider value={host}>{children}</AndroidSharedChromeHostContext.Provider>
}

export function AndroidInteractiveChrome({ children }: { children: ReactNode }) {
  const host = useContext(AndroidSharedChromeHostContext)
  const presentation = useAndroidPagerPagePresentation()
  const reducedMotion = useReducedMotion()
  const fallbackProgress = useMotionValue(0)
  const progress = presentation.progress ?? fallbackProgress
  const opacity = useTransform(progress, (value) => (presentation.role === 'target' ? value : 1 - value))
  const transform = useTransform(progress, (value) => {
    if (reducedMotion || !presentation.transitioning) return 'translate3d(0, 0, 0)'
    const distance = presentation.role === 'target' ? (1 - value) * 10 : -value * 10
    return `translate3d(${presentation.direction * distance}px, 0, 0)`
  })
  const chrome = (
    <motion.header
      className="yachiyo-interactive-header"
      data-shared-chrome-layer={presentation.role}
      data-yachiyo-tab-swipe="block"
      aria-hidden={presentation.role === 'target' || undefined}
      ref={(node) => {
        if (node) node.inert = presentation.role === 'target' || presentation.transitioning
      }}
      style={{
        opacity,
        transform,
        pointerEvents: presentation.role === 'target' || presentation.transitioning ? 'none' : 'auto',
      }}
    >
      {children}
    </motion.header>
  )

  return host ? createPortal(chrome, host) : chrome
}

export function AndroidStandardChromeLayer({
  activeInteractive,
  transition,
  children,
}: {
  activeInteractive: boolean
  transition?: AndroidTabTransitionSnapshot
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const fallbackProgress = useMotionValue(0)
  const progress = transition?.progress ?? fallbackProgress
  const sourceInteractive = transition?.sourceId === 'interactive'
  const targetInteractive = transition?.targetId === 'interactive'
  const crossesInteractive = Boolean(sourceInteractive || targetInteractive)
  const opacity = useTransform(progress, (value) => {
    if (!transition) return activeInteractive ? 0 : 1
    if (sourceInteractive) return value
    if (targetInteractive) return 1 - value
    return 1
  })
  const transform = useTransform(progress, (value) => {
    if (reducedMotion || !transition || !crossesInteractive) return 'translate3d(0, 0, 0)'
    const distance = sourceInteractive ? (1 - value) * 10 : -value * 10
    return `translate3d(${transition.direction * distance}px, 0, 0)`
  })

  return (
    <motion.div
      className="yachiyo-shared-standard-chrome"
      data-active={activeInteractive ? 'false' : 'true'}
      aria-hidden={activeInteractive || undefined}
      ref={(node) => {
        if (node) node.inert = activeInteractive
      }}
      style={{
        opacity,
        transform,
        pointerEvents: activeInteractive || crossesInteractive ? 'none' : 'auto',
      }}
    >
      {children}
    </motion.div>
  )
}
