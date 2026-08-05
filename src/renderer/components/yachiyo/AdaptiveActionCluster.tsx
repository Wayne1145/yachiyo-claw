import { ActionIcon, Menu } from '@mantine/core'
import { IconDots, type IconProps } from '@tabler/icons-react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  type ElementType,
  Fragment,
  type MouseEventHandler,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ADAPTIVE_CONTROL_RECOVERY_MARGIN_PX,
  type AdaptiveControlDensity,
  useAdaptiveControlDensity,
} from './useAdaptiveControlDensity'
import { useAndroidPagerGestureLock } from './android-pager-gesture-lock'
import './adaptive-action-cluster.css'

export type AdaptiveActionCollapseStrategy = 'keep' | 'icon' | 'overflow' | 'icon-then-overflow'
export type AdaptiveActionPresentation = 'labelled' | 'icon'

interface AdaptiveActionDescriptorBase {
  id: string
  label: string
  icon?: ElementType<IconProps>
  /** Higher priority actions remain visible longer when room is constrained. */
  priority: number
  group?: string
  disabled?: boolean
  /** Include state that changes the rendered control's intrinsic width. */
  layoutKey?: string | number
  renderControl: (context: { density: AdaptiveControlDensity; presentation: AdaptiveActionPresentation }) => ReactNode
}

interface RetainedAdaptiveActionDescriptor extends AdaptiveActionDescriptorBase {
  collapseStrategy?: 'keep' | 'icon'
  menuAction?: never
}

interface OverflowAdaptiveActionDescriptor extends AdaptiveActionDescriptorBase {
  collapseStrategy: 'overflow' | 'icon-then-overflow'
  menuAction:
    | {
        onSelect: MouseEventHandler<HTMLButtonElement>
        disabled?: boolean
        render?: never
      }
    | {
        render: (context: { closeMenu: () => void }) => ReactNode
        onSelect?: never
        disabled?: never
      }
}

export type AdaptiveActionDescriptor = RetainedAdaptiveActionDescriptor | OverflowAdaptiveActionDescriptor

interface IndexedAdaptiveAction {
  action: AdaptiveActionDescriptor
  index: number
}

export function getAdaptiveOverflowActionIds(actions: readonly AdaptiveActionDescriptor[], count: number): Set<string> {
  const candidates: IndexedAdaptiveAction[] = actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => action.collapseStrategy === 'overflow' || action.collapseStrategy === 'icon-then-overflow')
    .sort((left, right) => left.action.priority - right.action.priority || right.index - left.index)

  return new Set(candidates.slice(0, Math.max(0, count)).map(({ action }) => action.id))
}

export interface AdaptiveActionClusterProps {
  actions: readonly AdaptiveActionDescriptor[]
  ariaLabel?: string
  className?: string
  overflowLabel?: string
}

const layoutTransition = { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const }

export function AdaptiveActionCluster({ actions, ariaLabel, className, overflowLabel }: AdaptiveActionClusterProps) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const actionLayoutKey = useMemo(
    () =>
      JSON.stringify(
        actions.map(({ id, label, priority, group, collapseStrategy, layoutKey }) => [
          id,
          label,
          priority,
          group,
          collapseStrategy,
          layoutKey,
        ])
      ),
    [actions]
  )
  const { containerRef, density, measurement, pointerActive, pointerHandlers, measure } =
    useAdaptiveControlDensity<HTMLDivElement>({ contentKey: actionLayoutKey })
  const [overflowCount, setOverflowCount] = useState(0)
  const [menuOpened, setMenuOpened] = useState(false)
  useAndroidPagerGestureLock(menuOpened)
  const previousDensityRef = useRef(density)
  const actionElementsRef = useRef(new Map<string, HTMLDivElement>())
  const actionWidthsRef = useRef(new Map<string, number>())
  const overflowTriggerRef = useRef<HTMLDivElement>(null)
  const overflowButtonRef = useRef<HTMLButtonElement>(null)
  const focusOverflowAfterLayoutRef = useRef(false)
  const focusedActionIdRef = useRef<string | undefined>(undefined)

  const overflowCandidates = useMemo(
    () =>
      actions
        .map((action, index) => ({ action, index }))
        .filter(
          ({ action }) => action.collapseStrategy === 'overflow' || action.collapseStrategy === 'icon-then-overflow'
        )
        .sort((left, right) => left.action.priority - right.action.priority || right.index - left.index),
    [actions]
  )

  const hiddenActionIds = useMemo(
    () => getAdaptiveOverflowActionIds(actions, density === 'overflow' ? overflowCount : 0),
    [actions, density, overflowCount]
  )
  const visibleActions = actions.filter((action) => !hiddenActionIds.has(action.id))
  const overflowActions = actions.filter((action) => hiddenActionIds.has(action.id))

  const queueOverflowFocusIfNeeded = (nextOverflowCount: number) => {
    const activeElement = document.activeElement
    if (!activeElement) {
      return
    }

    const nextHiddenActionIds = getAdaptiveOverflowActionIds(actions, nextOverflowCount)
    for (const [id, element] of actionElementsRef.current) {
      if (!hiddenActionIds.has(id) && nextHiddenActionIds.has(id) && element.contains(activeElement)) {
        focusedActionIdRef.current = id
        focusOverflowAfterLayoutRef.current = true
        return
      }
    }

    const rememberedActionId = focusedActionIdRef.current
    if (activeElement === document.body && rememberedActionId && nextHiddenActionIds.has(rememberedActionId)) {
      focusOverflowAfterLayoutRef.current = true
    }
  }

  useLayoutEffect(() => {
    if (previousDensityRef.current === density) {
      return
    }

    previousDensityRef.current = density
    const nextOverflowCount = density === 'overflow' && overflowCandidates.length > 0 ? 1 : 0
    queueOverflowFocusIfNeeded(nextOverflowCount)
    setOverflowCount(nextOverflowCount)
  }, [density, overflowCandidates.length])

  useLayoutEffect(() => {
    setOverflowCount((current) => Math.min(current, overflowCandidates.length))
  }, [overflowCandidates.length])

  useLayoutEffect(() => {
    for (const [id, element] of actionElementsRef.current) {
      const width = element.getBoundingClientRect().width || element.offsetWidth
      if (width > 0) {
        actionWidthsRef.current.set(id, width)
      }
    }

    const container = containerRef.current
    if (!container || density !== 'overflow' || pointerActive || container.clientWidth <= 0) {
      return
    }

    if (container.scrollWidth > container.clientWidth) {
      if (overflowCount < overflowCandidates.length) {
        const nextOverflowCount = Math.min(overflowCount + 1, overflowCandidates.length)
        queueOverflowFocusIfNeeded(nextOverflowCount)
        setOverflowCount(nextOverflowCount)
      }
      return
    }

    if (overflowCount === 0) {
      return
    }

    const candidate = overflowCandidates[overflowCount - 1]?.action
    if (!candidate) {
      return
    }

    const candidateWidth = actionWidthsRef.current.get(candidate.id)
    if (candidateWidth === undefined) {
      return
    }

    const overflowTriggerWidth = overflowTriggerRef.current?.getBoundingClientRect().width ?? 0
    const triggerCredit = overflowCount === 1 ? overflowTriggerWidth + 6 : 0
    const requiredRoom = Math.max(0, candidateWidth + 6 - triggerCredit)
    const availableRoom = container.clientWidth - container.scrollWidth
    if (availableRoom >= requiredRoom + ADAPTIVE_CONTROL_RECOVERY_MARGIN_PX) {
      setOverflowCount((current) => Math.max(0, current - 1))
    }
  }, [
    containerRef,
    density,
    measurement.clientWidth,
    measurement.scrollWidth,
    overflowCandidates,
    overflowCount,
    pointerActive,
  ])

  useLayoutEffect(() => {
    measure()
  }, [measure, overflowCount])

  useLayoutEffect(() => {
    if (!focusOverflowAfterLayoutRef.current || overflowActions.length === 0 || !overflowButtonRef.current) {
      return
    }

    focusOverflowAfterLayoutRef.current = false
    overflowButtonRef.current.focus({ preventScroll: true })
  }, [overflowActions])

  const unresolvedOverflow =
    density === 'overflow' &&
    overflowCount >= overflowCandidates.length &&
    measurement.clientWidth > 0 &&
    measurement.scrollWidth > measurement.clientWidth
  const translatedOverflowLabel = t('More')
  const resolvedOverflowLabel =
    overflowLabel ?? (typeof translatedOverflowLabel === 'string' ? translatedOverflowLabel : 'More')
  const rootClassName = ['yachiyo-adaptive-action-cluster', className].filter(Boolean).join(' ')

  return (
    <div
      ref={containerRef}
      className={rootClassName}
      role="toolbar"
      aria-label={ariaLabel}
      data-density={density}
      data-pointer-active={pointerActive || undefined}
      data-unresolved-overflow={unresolvedOverflow || undefined}
      data-yachiyo-tab-swipe="block"
      onFocusCapture={(event) => {
        const actionElement = (event.target as HTMLElement).closest<HTMLElement>('[data-action-id]')
        focusedActionIdRef.current =
          actionElement && containerRef.current?.contains(actionElement) ? actionElement.dataset.actionId : undefined
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget && !containerRef.current?.contains(nextTarget as Node)) {
          focusedActionIdRef.current = undefined
        }
      }}
      {...pointerHandlers}
    >
      {visibleActions.map((action, visibleIndex) => {
        const previousAction = visibleActions[visibleIndex - 1]
        const startsGroup = Boolean(previousAction && previousAction.group !== action.group)
        const presentation: AdaptiveActionPresentation =
          density !== 'comfortable' &&
          (action.collapseStrategy === 'icon' || action.collapseStrategy === 'icon-then-overflow')
            ? 'icon'
            : 'labelled'

        return (
          <motion.div
            layout="position"
            transition={reduceMotion ? { duration: 0 } : layoutTransition}
            key={action.id}
            ref={(element) => {
              if (element) {
                actionElementsRef.current.set(action.id, element)
              } else {
                actionElementsRef.current.delete(action.id)
              }
            }}
            className="yachiyo-adaptive-action-control"
            data-action-id={action.id}
            data-group-start={startsGroup || undefined}
          >
            {action.renderControl({ density, presentation })}
          </motion.div>
        )
      })}

      {overflowActions.length > 0 && (
        <motion.div
          layout="position"
          transition={reduceMotion ? { duration: 0 } : layoutTransition}
          ref={overflowTriggerRef}
          className="yachiyo-adaptive-action-overflow"
        >
          <Menu position="bottom-end" withinPortal opened={menuOpened} onChange={setMenuOpened}>
            <Menu.Target>
              <ActionIcon
                ref={overflowButtonRef}
                variant="subtle"
                color="gray"
                size={44}
                aria-label={resolvedOverflowLabel}
                title={resolvedOverflowLabel}
                data-yachiyo-tab-swipe="block"
              >
                <IconDots size={20} aria-hidden />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown className="yachiyo-adaptive-action-menu" data-yachiyo-tab-swipe="block">
              {overflowActions.map((action) => {
                if (action.collapseStrategy !== 'overflow' && action.collapseStrategy !== 'icon-then-overflow') {
                  return null
                }
                if (action.menuAction.render) {
                  return (
                    <Fragment key={action.id}>
                      {action.menuAction.render({ closeMenu: () => setMenuOpened(false) })}
                    </Fragment>
                  )
                }
                const Icon = action.icon
                return (
                  <Menu.Item
                    key={action.id}
                    disabled={action.disabled || action.menuAction.disabled}
                    leftSection={Icon ? <Icon size={18} aria-hidden /> : undefined}
                    onClick={action.menuAction.onSelect}
                    data-action-id={action.id}
                  >
                    {action.label}
                  </Menu.Item>
                )
              })}
            </Menu.Dropdown>
          </Menu>
        </motion.div>
      )}
    </div>
  )
}
