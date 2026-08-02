import { router } from '@/router'
import { AnimatePresence, motion, type Variants, useReducedMotion } from 'framer-motion'
import {
  forwardRef,
  type MutableRefObject,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useAndroidRetainedScroll } from './android-retained-state'

type SettingsStackDirection = 'forward' | 'back'
const EMPTY_SETTINGS_SEARCH: Record<string, unknown> = {}

interface AndroidSettingsStackEntry {
  key: string
  pathname: string
  search: Record<string, unknown>
  element: ReactNode
  transactionId: number
}

export interface AndroidSettingsStackHandle {
  pop: () => Promise<boolean>
  canPop: () => boolean
}

function settingsEntryKey(pathname: string, search: Record<string, unknown>): string {
  return `${pathname}:${JSON.stringify(search)}`
}

function SettingsStackPage({
  entry,
  active,
  reducedMotion,
}: {
  entry: AndroidSettingsStackEntry
  active: boolean
  reducedMotion: boolean
}) {
  const scrollRef = useAndroidRetainedScroll(`settings-stack:${entry.key}`)
  const mutableScrollRef = scrollRef as MutableRefObject<HTMLDivElement | null>
  const pageRef = useRef<HTMLDivElement | null>(null)
  const transition = reducedMotion
    ? { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const }
    : { type: 'spring' as const, mass: 1, stiffness: 420, damping: 40 }
  const variants: Variants = {
    enter: { x: reducedMotion ? 0 : '100%', opacity: reducedMotion ? 0 : 1 },
    visible: (isActive: boolean) => ({
      x: reducedMotion || isActive ? 0 : '-10%',
      opacity: 1,
      zIndex: isActive ? 2 : 1,
    }),
    exit: { x: reducedMotion ? 0 : '100%', opacity: reducedMotion ? 0 : 1, zIndex: 3 },
  }

  useEffect(() => {
    if (pageRef.current) pageRef.current.inert = !active
  }, [active])

  return (
    <motion.div
      ref={(node) => {
        pageRef.current = node
        mutableScrollRef.current = node
        if (node) (node as HTMLDivElement & { inert: boolean }).inert = !active
      }}
      className="yachiyo-settings-stack-page"
      variants={variants}
      custom={active}
      initial="enter"
      animate="visible"
      exit="exit"
      transition={transition}
      aria-hidden={!active}
      data-settings-path={entry.pathname}
      data-settings-active={active ? 'true' : 'false'}
    >
      {entry.element}
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
  const reducedMotion = Boolean(useReducedMotion())
  const transactionRef = useRef(0)
  const entriesRef = useRef<AndroidSettingsStackEntry[]>([])
  const [direction, setDirection] = useState<SettingsStackDirection>('forward')
  const [entries, setEntries] = useState<AndroidSettingsStackEntry[]>(() => [
    {
      key: settingsEntryKey(pathname, search),
      pathname,
      search,
      element: children,
      transactionId: 0,
    },
  ])
  entriesRef.current = entries

  useEffect(() => {
    const key = settingsEntryKey(pathname, search)
    const current = entriesRef.current
    const existingIndex = current.findIndex((entry) => entry.key === key)
    const transactionId = ++transactionRef.current
    let next: AndroidSettingsStackEntry[]
    if (existingIndex >= 0) {
      if (existingIndex !== current.length - 1) setDirection('back')
      next = current.slice(0, existingIndex + 1)
      next[existingIndex] = { ...next[existingIndex], element: children, transactionId }
    } else {
      setDirection('forward')
      next = [...current, { key, pathname, search, element: children, transactionId }].slice(-8)
    }
    entriesRef.current = next
    setEntries(next)
  }, [children, pathname, search])

  useImperativeHandle(
    ref,
    () => ({
      canPop: () => entriesRef.current.length > 1,
      pop: async () => {
        const current = entriesRef.current
        if (current.length <= 1) return false
        const target = current[current.length - 2]
        setDirection('back')
        await router.navigate({
          to: target.pathname as '/',
          search: target.search as never,
          replace: true,
        })
        return true
      },
    }),
    []
  )

  return (
    <div className="yachiyo-settings-stack" data-direction={direction}>
      <AnimatePresence initial={false} custom={direction}>
        {entries.map((entry, index) => (
          <SettingsStackPage
            key={entry.key}
            entry={entry}
            active={index === entries.length - 1}
            reducedMotion={reducedMotion}
          />
        ))}
      </AnimatePresence>
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
