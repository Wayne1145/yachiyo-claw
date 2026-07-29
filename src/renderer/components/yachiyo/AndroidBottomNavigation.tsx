import { motion, type MotionValue, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { type CSSProperties, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getAndroidShellTabs, type AndroidShellTab } from '@/mobile/android-app-shell'
import { useSettingsStore } from '@/stores/settingsStore'

type BottomNavigationStyle = CSSProperties & {
  '--yachiyo-tab-count': number
}

interface BottomNavigationTransition {
  sourceIndex: number
  targetIndex: number
  progress: MotionValue<number>
}

export function AndroidBottomNavigation({
  activeTab,
  onChange,
  items: providedItems,
  presentationIndex,
  transition,
  reducedMotion,
}: {
  activeTab: AndroidShellTab
  onChange: (tab: AndroidShellTab) => void
  items?: readonly ReturnType<typeof getAndroidShellTabs>[number][]
  presentationIndex?: MotionValue<number>
  transition?: BottomNavigationTransition
  reducedMotion?: boolean
}) {
  const { t, i18n } = useTranslation()
  const overrides = useSettingsStore((state) => state.featureOverrides)
  const defaultItems = useMemo(() => getAndroidShellTabs(overrides), [overrides])
  const items = providedItems ?? defaultItems
  const prefersReducedMotion = useReducedMotion()
  const shouldReduceMotion = reducedMotion ?? Boolean(prefersReducedMotion)
  const activeIndex = items.findIndex((item) => item.id === activeTab)
  const fallbackPresentationIndex = useMotionValue(activeIndex)
  const resolvedPresentationIndex = presentationIndex ?? fallbackPresentationIndex
  useEffect(() => {
    if (!presentationIndex) fallbackPresentationIndex.set(activeIndex)
  }, [activeIndex, fallbackPresentationIndex, presentationIndex])
  const direction = i18n.dir() === 'rtl' ? -1 : 1
  const lensTransform = useTransform(
    resolvedPresentationIndex,
    (value) => `translate3d(${value * direction * 100}%, 0, 0)`
  )
  const reducedLensTransform = `translate3d(${Math.max(0, activeIndex) * direction * 100}%, 0, 0)`
  const lensInnerTransform = useTransform(resolvedPresentationIndex, () => {
    const stretch = Math.min(0.05, Math.abs(resolvedPresentationIndex.getVelocity()) / 12_000)
    return `scaleX(${1 + stretch})`
  })
  const style: BottomNavigationStyle = {
    '--yachiyo-tab-count': Math.max(1, items.length),
  }
  return (
    <nav
      className="yachiyo-bottom-nav"
      data-transitioning={transition ? 'true' : 'false'}
      aria-label={String(t('主导航'))}
    >
      <div className="yachiyo-bottom-nav-grid" style={style}>
        <motion.span
          className="yachiyo-bottom-nav-lens"
          style={{ transform: shouldReduceMotion ? reducedLensTransform : lensTransform }}
          aria-hidden="true"
          hidden={activeIndex < 0}
        >
          <motion.span
            className="yachiyo-bottom-nav-lens-inner"
            style={{ transform: shouldReduceMotion ? 'scaleX(1)' : lensInnerTransform }}
          />
        </motion.span>
        {items.map((item, index) => (
          <AndroidBottomNavigationItem
            key={item.id}
            item={item}
            index={index}
            active={activeTab === item.id}
            label={String(t(item.label))}
            transition={transition}
            reducedMotion={shouldReduceMotion}
            onChange={onChange}
          />
        ))}
      </div>
    </nav>
  )
}

function AndroidBottomNavigationItem({
  item,
  index,
  active,
  label,
  transition,
  reducedMotion,
  onChange,
}: {
  item: ReturnType<typeof getAndroidShellTabs>[number]
  index: number
  active: boolean
  label: string
  transition?: BottomNavigationTransition
  reducedMotion: boolean
  onChange: (tab: AndroidShellTab) => void
}) {
  const Icon = item.icon
  const MotionIcon = useMemo(() => motion.create(Icon), [Icon])
  const fallbackActivation = useMotionValue(active ? 1 : 0)
  useEffect(() => fallbackActivation.set(active ? 1 : 0), [active, fallbackActivation])
  const transitionActivation = useTransform(transition?.progress ?? fallbackActivation, (progress) => {
    if (!transition) return active ? 1 : 0
    if (index === transition.sourceIndex) return 1 - progress
    if (index === transition.targetIndex) return progress
    return 0
  })
  const itemOpacity = useTransform(transitionActivation, [0, 1], [0.76, 1])
  const itemTransform = useTransform(transitionActivation, [0, 1], ['translate3d(0, 1px, 0)', 'translate3d(0, 0, 0)'])
  const labelColor = useTransform(
    transitionActivation,
    (value) =>
      `color-mix(in srgb, var(--yachiyo-tab-active-label-color) ${value * 100}%, var(--yachiyo-tab-idle-color))`
  )
  const iconColor = useTransform(
    transitionActivation,
    (value) => `color-mix(in srgb, var(--yachiyo-tab-active-icon-color) ${value * 100}%, var(--yachiyo-tab-idle-color))`
  )
  const labelWeight = useTransform(transitionActivation, [0, 1], [560, 650])
  const iconStroke = useTransform(transitionActivation, [0, 1], [1.7, 2.2])

  return (
    <button
      type="button"
      className="yachiyo-bottom-nav-item"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined}
      onClick={() => onChange(item.id)}
    >
      <motion.span
        className="yachiyo-bottom-nav-item-content"
        style={{
          color: labelColor,
          fontWeight: labelWeight,
          opacity: itemOpacity,
          transform: reducedMotion ? 'none' : itemTransform,
        }}
      >
        <MotionIcon size={22} stroke={1.7} style={{ color: iconColor, strokeWidth: iconStroke }} aria-hidden="true" />
        <span>{label}</span>
      </motion.span>
    </button>
  )
}
