import { router } from '@/router'
import { motion, type Variants, useReducedMotion } from 'framer-motion'
import { forwardRef, type ReactNode, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { useAndroidRetainedScroll } from './android-retained-state'

const EMPTY_SETTINGS_SEARCH: Record<string, unknown> = {}
interface AndroidSettingsStackEntry {
  key: string
  pathname: string
  search: Record<string, unknown>
}
export interface AndroidSettingsStackHandle {
  pop: () => Promise<boolean>
  canPop: () => boolean
}
function settingsEntryKey(pathname: string, search: Record<string, unknown>): string {
  return `${pathname}:${JSON.stringify(search)}`
}
function SettingsStackPage({
  pathname,
  entryKey,
  direction,
  children,
}: {
  pathname: string
  entryKey: string
  direction: 'forward' | 'back'
  children: ReactNode
}) {
  const scrollRef = useAndroidRetainedScroll(`settings-stack:${entryKey}`)
  const reducedMotion = Boolean(useReducedMotion())
  return (
    <motion.div
      ref={scrollRef}
      className="yachiyo-settings-stack-page"
      initial={{ opacity: reducedMotion ? 1 : 0, x: reducedMotion ? 0 : direction === 'forward' ? 12 : -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' }}
      data-settings-path={pathname}
      data-settings-active="true"
    >
      {children}
    </motion.div>
  )
}

export const AndroidSettingsStackSurface = forwardRef<
  AndroidSettingsStackHandle,
  {
    pathname: string
    search?: Record<string, unknown>
    children: ReactNode
  }
>(function AndroidSettingsStackSurface({ pathname, search = EMPTY_SETTINGS_SEARCH, children }, ref) {
  const key = settingsEntryKey(pathname, search)
  const entriesRef = useRef<AndroidSettingsStackEntry[]>([{ key, pathname, search }])
  const existing = entriesRef.current.findIndex((entry) => entry.key === key)
  const direction = existing >= 0 && existing < entriesRef.current.length - 1 ? 'back' : 'forward'
  useLayoutEffect(() => {
    const current = entriesRef.current
    const index = current.findIndex((entry) => entry.key === key)
    entriesRef.current = index >= 0 ? current.slice(0, index + 1) : [...current, { key, pathname, search }].slice(-8)
  }, [key, pathname, search])
  useImperativeHandle(
    ref,
    () => ({
      canPop: () => entriesRef.current.length > 1,
      pop: async () => {
        const entries = entriesRef.current
        if (entries.length <= 1) return false
        const target = entries[entries.length - 2]
        await router.navigate({ to: target.pathname as '/', search: target.search as never, replace: true })
        return true
      },
    }),
    []
  )
  // An Outlet is live router content, not a frozen page snapshot. Keeping previous
  // Outlets mounted duplicates the current form and its effects on every navigation.
  return (
    <div className="yachiyo-settings-stack" data-direction={direction}>
      <SettingsStackPage key={key} pathname={pathname} entryKey={key} direction={direction}>
        {children}
      </SettingsStackPage>
    </div>
  )
})

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
  }

  return (
    <div className={className}>
      <motion.div
        key={pathname}
        className="yachiyo-settings-chrome-layer"
        variants={variants}
        initial="enter"
        animate="center"
        custom={direction}
        transition={transition}
      >
        {children}
      </motion.div>
    </div>
  )
}
