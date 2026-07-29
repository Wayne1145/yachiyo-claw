import { AnimatePresence, motion, type Variants, useReducedMotion } from 'framer-motion'
import { type ReactNode, useRef } from 'react'
import { useAndroidRetainedScroll } from './android-retained-state'

function getSettingsDepth(pathname: string): number {
  if (pathname === '/settings') return 0
  return pathname.split('/').filter(Boolean).length
}

function useSettingsNavigationDirection(pathname: string): 1 | -1 {
  const previousPathRef = useRef(pathname)
  const previousDepth = getSettingsDepth(previousPathRef.current)
  const nextDepth = getSettingsDepth(pathname)
  const direction = nextDepth >= previousDepth ? 1 : -1
  previousPathRef.current = pathname
  return direction
}

function SettingsStackPage({
  pathname,
  reducedMotion,
  children,
}: {
  pathname: string
  reducedMotion: boolean
  children: ReactNode
}) {
  const scrollRef = useAndroidRetainedScroll(`settings-stack:${pathname}`)
  const transition = reducedMotion
    ? { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const }
    : { type: 'spring' as const, mass: 1, stiffness: 420, damping: 40 }
  const variants: Variants = {
    enter: (custom: number) => ({
      x: reducedMotion ? 0 : custom > 0 ? '100%' : '-24%',
      opacity: reducedMotion ? 0 : 0.96,
      zIndex: custom > 0 ? 2 : 1,
    }),
    center: { x: 0, opacity: 1, zIndex: 2 },
    exit: (custom: number) => ({
      x: reducedMotion ? 0 : custom > 0 ? '-24%' : '100%',
      opacity: reducedMotion ? 0 : 0.96,
      zIndex: custom > 0 ? 1 : 3,
      pointerEvents: 'none',
    }),
  }

  return (
    <motion.div
      ref={scrollRef}
      className="yachiyo-settings-stack-page"
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={transition}
      data-settings-path={pathname}
    >
      {children}
    </motion.div>
  )
}

export function AndroidSettingsStackSurface({ pathname, children }: { pathname: string; children: ReactNode }) {
  const reducedMotion = Boolean(useReducedMotion())
  const direction = useSettingsNavigationDirection(pathname)

  return (
    <div className="yachiyo-settings-stack" data-direction={direction > 0 ? 'forward' : 'back'}>
      <AnimatePresence initial={false} custom={direction}>
        <SettingsStackPage
          key={pathname}
          pathname={pathname}
          reducedMotion={reducedMotion}
        >
          {children}
        </SettingsStackPage>
      </AnimatePresence>
    </div>
  )
}

export function AndroidSettingsChromeTransition({
  pathname,
  className,
  children,
}: {
  pathname: string
  className: string
  children: ReactNode
}) {
  const reducedMotion = Boolean(useReducedMotion())
  const direction = useSettingsNavigationDirection(pathname)
  const transition = reducedMotion
    ? { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const }
    : { type: 'spring' as const, mass: 1, stiffness: 420, damping: 40 }
  const variants: Variants = {
    enter: (custom: number) => ({ x: reducedMotion ? 0 : custom * 10, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (custom: number) => ({ x: reducedMotion ? 0 : custom * -10, opacity: 0 }),
  }

  return (
    <div className={className}>
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={pathname}
          className="yachiyo-settings-chrome-layer"
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={transition}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
