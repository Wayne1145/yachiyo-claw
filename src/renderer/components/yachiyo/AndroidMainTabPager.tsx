import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import {
  animate,
  motion,
  type MotionValue,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from 'framer-motion'
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { AndroidShellTab } from '@/mobile/android-app-shell'
import { flowGlassHaptics } from '@/utils/mobile-haptics'
import { AndroidBottomNavigation } from './AndroidBottomNavigation'
import {
  appendAndroidPagerSample,
  type AndroidPagerAxisDecision,
  type AndroidPagerPositionSample,
  clampAndroidPagerVisualOffset,
  estimateAndroidPagerVelocity,
  resolveAndroidPagerAxis,
  resolveAndroidPagerTargetIndex,
  rubberBandAndroidPagerOffset,
  shouldCommitAndroidPagerTransition,
} from './android-main-tab-pager-physics'
import { hasOpenAndroidPagerBlockingLayer, useAndroidPagerGesturesLocked } from './android-pager-gesture-lock'
import {
  type AndroidPagerPagePresentation,
  AndroidPagerPagePresentationProvider,
} from './android-pager-page-presentation'
import type { AndroidTabPageActivity } from './android-tab-page-activity'

export type AndroidPagerPhase = 'idle' | 'tracking' | 'settling' | 'routing'

export interface AndroidTabTransitionSnapshot {
  sourceId: AndroidShellTab
  sourceIndex: number
  targetId: AndroidShellTab
  targetIndex: number
  progress: MotionValue<number>
  velocity: MotionValue<number>
  direction: -1 | 1
  requestSource: 'tap' | 'drag'
  transactionId: number
}

export interface AndroidPagerInteractionState {
  systemGestureInsetsCssPx: { left: number; right: number }
  touchExplorationEnabled: boolean
}

export interface AndroidMainTabPagerItem {
  id: AndroidShellTab
  label: string
  icon: React.ComponentType<{
    size?: number | string
    stroke?: number | string
    color?: string
    className?: string
  }>
  order: number
  route: string
}

interface AndroidPagerTransition {
  sourceIndex: number
  targetIndex: number
  targetTab: AndroidShellTab
  source: 'tap' | 'drag'
}

interface ActivePointerGesture {
  pointerId: number
  startX: number
  startY: number
  baseOffset: number
  axis: AndroidPagerAxisDecision
  samples: AndroidPagerPositionSample[]
  resumeTarget: boolean
}

const BLOCKED_GESTURE_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="slider"]',
  '[role="switch"]',
  '[data-menu-dropdown]',
  '[data-rmiz-modal-overlay]',
  '[data-vaul-drawer]',
  '[data-yachiyo-tab-swipe="block"]',
].join(',')

const TAP_SPRING = { type: 'spring' as const, mass: 1, stiffness: 420, damping: 40 }
const FLICK_SPRING = { type: 'spring' as const, mass: 1, stiffness: 420, damping: 34 }

function gestureStartsInBlockedElement(event: ReactPointerEvent<HTMLElement>): boolean {
  return event.nativeEvent.composedPath().some((target) => {
    if (!(target instanceof Element)) return false
    if (target.matches(BLOCKED_GESTURE_SELECTOR)) return true
    if (!(target instanceof HTMLElement)) return false
    if (target.matches('pre, table')) return true
    const overflowX = getComputedStyle(target).overflowX
    return (overflowX === 'auto' || overflowX === 'scroll') && target.scrollWidth > target.clientWidth
  })
}

function isRtl(element: HTMLElement): boolean {
  return getComputedStyle(element).direction === 'rtl'
}

function isKeyboardInput(element: Element | null): element is HTMLElement {
  return Boolean(
    element instanceof HTMLElement &&
      (element.matches('input:not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea') ||
        element.isContentEditable)
  )
}

export function AndroidMainTabPager({
  activeTab,
  items,
  children,
  renderSource,
  renderPreview,
  onChange,
  onTransitionChange,
  interactionState,
}: {
  activeTab: AndroidShellTab
  items: readonly AndroidMainTabPagerItem[]
  children: ReactNode
  renderSource?: (activity: AndroidTabPageActivity) => ReactNode
  renderPreview: (tab: AndroidShellTab) => ReactNode
  onChange: (tab: AndroidShellTab) => Promise<void> | void
  onTransitionChange?: (snapshot: AndroidTabTransitionSnapshot | undefined) => void
  interactionState?: AndroidPagerInteractionState
}) {
  const reducedMotion = useReducedMotion()
  const gesturesLocked = useAndroidPagerGesturesLocked()
  const trackRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<ActivePointerGesture>()
  const animationRef = useRef<Array<ReturnType<typeof animate>>>([])
  const keyboardCleanupRef = useRef<() => void>()
  const keyboardDismissalInProgressRef = useRef(false)
  const transactionRef = useRef(0)
  const widthRef = useRef(1)
  const sourceIndexRef = useRef(0)
  const targetIndexRef = useRef<number>()
  const targetBaseRef = useRef(0)
  const drivePresentationFromOffsetRef = useRef(true)
  const driveProgressFromOffsetRef = useRef(true)
  const [phase, setPhase] = useState<AndroidPagerPhase>('idle')
  const [transition, setTransition] = useState<AndroidPagerTransition>()
  const offset = useMotionValue(0)
  const progress = useMotionValue(0)
  const presentationIndex = useMotionValue(0)
  const releaseVelocity = useMotionValue(0)
  const targetBase = useMotionValue(0)
  const clampVisualOffset = useCallback((value: number) => {
    if (targetIndexRef.current === undefined) return value
    return clampAndroidPagerVisualOffset(value, -targetBaseRef.current)
  }, [])
  const sourceTransform = useTransform(offset, (value) => {
    const visualOffset = clampVisualOffset(value)
    return reducedMotion ? 'translate3d(0, 0, 0)' : `translate3d(${visualOffset}px, 0, 0)`
  })
  const targetTransform = useTransform([offset, targetBase], (values) => {
    const currentOffset = clampVisualOffset(Number(values[0]))
    const currentTargetBase = Number(values[1])
    return reducedMotion ? 'translate3d(0, 0, 0)' : `translate3d(${currentOffset + currentTargetBase}px, 0, 0)`
  })
  const sourceOpacity = useTransform(progress, [0, 1], [1, reducedMotion ? 0 : 1])
  const targetOpacity = useTransform(progress, [0, 1], [reducedMotion ? 0 : 1, 1])
  const seamTransform = useTransform([offset, targetBase], (values) => {
    const currentOffset = Number(values[0])
    const currentTargetBase = Number(values[1])
    const boundary = currentTargetBase >= 0 ? currentOffset + currentTargetBase : currentOffset
    return `translate3d(${boundary}px, 0, 0)`
  })
  const activeIndex = items.findIndex((item) => item.id === activeTab)
  const sourceActivity: AndroidTabPageActivity =
    phase === 'idle' ? 'active' : phase === 'routing' ? 'inactive' : 'preview'

  sourceIndexRef.current = activeIndex

  const updateProgressFromOffset = useCallback(
    (value: number) => {
      const targetIndex = targetIndexRef.current
      const sourceIndex = sourceIndexRef.current
      if (targetIndex === undefined) {
        progress.set(0)
        if (drivePresentationFromOffsetRef.current) presentationIndex.set(sourceIndex)
        return
      }
      const nextProgress = Math.max(0, Math.min(1, Math.abs(value) / Math.max(1, widthRef.current)))
      if (driveProgressFromOffsetRef.current) progress.set(nextProgress)
      if (drivePresentationFromOffsetRef.current) {
        presentationIndex.set(sourceIndex + (targetIndex - sourceIndex) * nextProgress)
      }
    },
    [presentationIndex, progress]
  )

  useMotionValueEvent(offset, 'change', updateProgressFromOffset)

  useEffect(() => {
    if (!transition) {
      onTransitionChange?.(undefined)
      return
    }
    const sourceId = items[transition.sourceIndex]?.id
    if (!sourceId) return
    onTransitionChange?.({
      sourceId,
      sourceIndex: transition.sourceIndex,
      targetId: transition.targetTab,
      targetIndex: transition.targetIndex,
      progress,
      velocity: releaseVelocity,
      direction: targetBaseRef.current < 0 ? -1 : 1,
      requestSource: transition.source,
      transactionId: transactionRef.current,
    })
  }, [items, onTransitionChange, progress, releaseVelocity, transition])

  useEffect(() => {
    if (transition) return
    offset.set(0)
    progress.set(0)
    presentationIndex.set(activeIndex)
  }, [activeIndex, offset, presentationIndex, progress, transition])

  const stopAnimations = useCallback(() => {
    for (const animation of animationRef.current) animation.stop()
    animationRef.current = []
  }, [])

  useEffect(
    () => () => {
      stopAnimations()
      keyboardCleanupRef.current?.()
    },
    [stopAnimations]
  )

  const dismissKeyboardForCommit = useCallback(async () => {
    const focusedElement = document.activeElement
    const track = trackRef.current
    if (!track || !isKeyboardInput(focusedElement)) return
    const frozenTrack = track

    keyboardCleanupRef.current?.()
    keyboardDismissalInProgressRef.current = true
    track.style.blockSize = `${track.clientHeight}px`
    track.dataset.keyboardSettling = 'true'
    focusedElement.blur()

    if (!Capacitor.isNativePlatform()) {
      keyboardDismissalInProgressRef.current = false
      track.style.removeProperty('block-size')
      delete track.dataset.keyboardSettling
      return
    }

    await new Promise<void>((resolve) => {
      let completed = false
      let listenerHandle: Awaited<ReturnType<typeof Keyboard.addListener>> | undefined
      const timeout = window.setTimeout(finish, 300)
      function finish() {
        if (completed) return
        completed = true
        window.clearTimeout(timeout)
        if (listenerHandle) void listenerHandle.remove()
        keyboardDismissalInProgressRef.current = false
        frozenTrack.style.removeProperty('block-size')
        delete frozenTrack.dataset.keyboardSettling
        keyboardCleanupRef.current = undefined
        resolve()
      }
      keyboardCleanupRef.current = finish
      void Keyboard.addListener('keyboardDidHide', finish).then((handle) => {
        if (completed) void handle.remove()
        else listenerHandle = handle
      })
      void Keyboard.hide().catch(finish)
    })
  }, [])

  const setTarget = useCallback(
    (targetIndex: number, source: AndroidPagerTransition['source'], width: number) => {
      const sourceIndex = sourceIndexRef.current
      const targetTab = items[targetIndex]?.id
      if (!targetTab || targetIndex === sourceIndex) return false
      const rtl = trackRef.current ? isRtl(trackRef.current) : false
      const logicalDirection = Math.sign(targetIndex - sourceIndex) || 1
      const visualDirection = rtl ? -logicalDirection : logicalDirection
      targetIndexRef.current = targetIndex
      targetBaseRef.current = visualDirection * width
      targetBase.set(targetBaseRef.current)
      setTransition({ sourceIndex, targetIndex, targetTab, source })
      return true
    },
    [items, targetBase]
  )

  const clearTransition = useCallback(
    (committedIndex = sourceIndexRef.current) => {
      targetIndexRef.current = undefined
      targetBaseRef.current = 0
      targetBase.set(0)
      offset.set(0)
      progress.set(0)
      presentationIndex.set(committedIndex)
      drivePresentationFromOffsetRef.current = true
      driveProgressFromOffsetRef.current = true
      setTransition(undefined)
      setPhase('idle')
    },
    [offset, presentationIndex, progress, targetBase]
  )

  const settle = useCallback(
    async (commit: boolean, velocity: number, source: AndroidPagerTransition['source']) => {
      const targetIndex = targetIndexRef.current
      const targetTab = targetIndex === undefined ? undefined : items[targetIndex]?.id
      const transaction = ++transactionRef.current
      stopAnimations()
      setPhase('settling')

      if (!commit || targetIndex === undefined || !targetTab) {
        drivePresentationFromOffsetRef.current = false
        driveProgressFromOffsetRef.current = !reducedMotion
        const animations = reducedMotion
          ? [
              animate(progress, 0, { duration: 0.18, ease: [0.23, 1, 0.32, 1] }),
              animate(presentationIndex, sourceIndexRef.current, { duration: 0.18, ease: [0.23, 1, 0.32, 1] }),
            ]
          : [
              animate(offset, 0, { ...TAP_SPRING, velocity }),
              animate(presentationIndex, sourceIndexRef.current, { ...TAP_SPRING, velocity: 0 }),
            ]
        animationRef.current = animations
        await Promise.all(animations)
        if (transaction === transactionRef.current) clearTransition()
        return
      }

      const targetOffset = -targetBaseRef.current
      const keyboardDismissal = dismissKeyboardForCommit()
      if (reducedMotion) {
        driveProgressFromOffsetRef.current = false
        offset.set(0)
        drivePresentationFromOffsetRef.current = false
        const progressAnimation = animate(progress, 1, { duration: 0.18, ease: [0.23, 1, 0.32, 1] })
        const presentationAnimation = animate(presentationIndex, targetIndex, {
          duration: 0.18,
          ease: [0.23, 1, 0.32, 1],
        })
        animationRef.current = [progressAnimation, presentationAnimation]
        await Promise.all([progressAnimation, presentationAnimation])
      } else {
        driveProgressFromOffsetRef.current = true
        drivePresentationFromOffsetRef.current = source === 'drag'
        const offsetAnimation = animate(offset, targetOffset, {
          ...(source === 'drag' && Math.abs(velocity) >= 650 ? FLICK_SPRING : TAP_SPRING),
          velocity,
        })
        const animations = [offsetAnimation]
        if (source === 'tap') animations.push(animate(presentationIndex, targetIndex, TAP_SPRING))
        animationRef.current = animations
        await Promise.all(animations)
      }
      await keyboardDismissal
      if (transaction !== transactionRef.current) return

      setPhase('routing')
      try {
        await onChange(targetTab)
      } catch {
        if (transaction !== transactionRef.current) return
        const recoveryAnimation = animate(offset, 0, TAP_SPRING)
        animationRef.current = [recoveryAnimation]
        await recoveryAnimation
        clearTransition()
        return
      }
      if (transaction !== transactionRef.current) return
      clearTransition(targetIndex)
      void flowGlassHaptics.selection()
    },
    [
      clearTransition,
      dismissKeyboardForCommit,
      items,
      offset,
      onChange,
      presentationIndex,
      progress,
      reducedMotion,
      stopAnimations,
    ]
  )

  const requestTab = useCallback(
    (tab: AndroidShellTab) => {
      const targetIndex = items.findIndex((item) => item.id === tab)
      if (targetIndex < 0) return
      if (sourceIndexRef.current < 0) {
        const transaction = ++transactionRef.current
        void Promise.resolve(onChange(tab))
          .then(() => {
            if (transaction === transactionRef.current) void flowGlassHaptics.selection()
          })
          .catch(() => undefined)
        return
      }
      if (targetIndex === sourceIndexRef.current) {
        if (targetIndexRef.current === undefined) return
        stopAnimations()
        setPhase('settling')
        void settle(false, 0, 'tap')
        return
      }
      const width = Math.max(1, trackRef.current?.clientWidth ?? widthRef.current)
      widthRef.current = width
      stopAnimations()
      if (!setTarget(targetIndex, 'tap', width)) return
      setPhase('settling')
      void settle(true, 0, 'tap')
    },
    [items, onChange, setTarget, settle, stopAnimations]
  )

  const cancelPointerGesture = useCallback(() => {
    pointerRef.current = undefined
  }, [])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'touch') return
      if (!event.isPrimary) {
        const activeGesture = pointerRef.current
        if (activeGesture) {
          pointerRef.current = undefined
          if (event.currentTarget.hasPointerCapture(activeGesture.pointerId)) {
            event.currentTarget.releasePointerCapture(activeGesture.pointerId)
          }
          void settle(false, 0, 'drag')
        }
        return
      }
      if (
        sourceIndexRef.current < 0 ||
        gesturesLocked ||
        interactionState?.touchExplorationEnabled ||
        hasOpenAndroidPagerBlockingLayer() ||
        gestureStartsInBlockedElement(event)
      ) {
        return
      }
      const rect = event.currentTarget.getBoundingClientRect()
      const leftInset = (interactionState?.systemGestureInsetsCssPx.left ?? 0) + 8
      const rightInset = (interactionState?.systemGestureInsetsCssPx.right ?? 0) + 8
      if (event.clientX - rect.left <= leftInset || rect.right - event.clientX <= rightInset) return

      stopAnimations()
      transactionRef.current += 1
      widthRef.current = Math.max(1, event.currentTarget.clientWidth)
      pointerRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        baseOffset: offset.get(),
        axis: 'pending',
        samples: [{ position: event.clientX, time: event.timeStamp }],
        resumeTarget: targetIndexRef.current !== undefined,
      }
    },
    [gesturesLocked, interactionState, offset, settle, stopAnimations]
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = pointerRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      const dx = event.clientX - gesture.startX
      const dy = event.clientY - gesture.startY
      if (gesture.axis === 'pending') {
        gesture.axis = resolveAndroidPagerAxis(dx, dy)
        if (gesture.axis === 'vertical') {
          cancelPointerGesture()
          if (gesture.resumeTarget) void settle(true, 0, transition?.source ?? 'tap')
          else if (offset.get() !== 0) void settle(false, 0, 'drag')
          return
        }
        if (gesture.axis === 'pending') return
        event.currentTarget.setPointerCapture(event.pointerId)
        setPhase('tracking')
      }

      const rawOffset = gesture.baseOffset + dx
      const rtl = isRtl(event.currentTarget)
      const targetIndex = resolveAndroidPagerTargetIndex({
        sourceIndex: sourceIndexRef.current,
        offset: rawOffset,
        itemCount: items.length,
        rtl,
      })
      if (targetIndex === undefined) {
        targetIndexRef.current = undefined
        setTransition(undefined)
        targetBase.set(0)
        offset.set(rubberBandAndroidPagerOffset(rawOffset, widthRef.current))
      } else {
        if (targetIndexRef.current !== targetIndex) setTarget(targetIndex, 'drag', widthRef.current)
        drivePresentationFromOffsetRef.current = true
        offset.set(rawOffset)
      }
      gesture.samples = appendAndroidPagerSample(gesture.samples, {
        position: event.clientX,
        time: event.timeStamp,
      })
      event.preventDefault()
    },
    [cancelPointerGesture, items.length, offset, setTarget, settle, targetBase, transition?.source]
  )

  const finishPointerGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
      const gesture = pointerRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      pointerRef.current = undefined
      if (gesture.axis !== 'horizontal') {
        if (gesture.resumeTarget) void settle(true, 0, transition?.source ?? 'tap')
        else if (offset.get() !== 0) void settle(false, 0, 'drag')
        return
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      const releaseSamples = cancelled
        ? gesture.samples
        : appendAndroidPagerSample(gesture.samples, {
            position: event.clientX,
            time: event.timeStamp,
          })
      const velocity = cancelled ? 0 : estimateAndroidPagerVelocity(releaseSamples)
      releaseVelocity.set(velocity)
      const commit =
        !cancelled &&
        targetIndexRef.current !== undefined &&
        shouldCommitAndroidPagerTransition({ offset: offset.get(), velocity, width: widthRef.current })
      void settle(commit, velocity, 'drag')
    },
    [offset, releaseVelocity, settle, transition?.source]
  )

  useEffect(() => {
    if (!pointerRef.current || (!gesturesLocked && !interactionState?.touchExplorationEnabled)) return
    pointerRef.current = undefined
    void settle(false, 0, 'drag')
  }, [gesturesLocked, interactionState?.touchExplorationEnabled, settle])

  useEffect(() => {
    const abortForEnvironmentChange = () => {
      if (keyboardDismissalInProgressRef.current) return
      if (!pointerRef.current && targetIndexRef.current === undefined) return
      transactionRef.current += 1
      pointerRef.current = undefined
      stopAnimations()
      clearTransition()
    }
    const onVisibilityChange = () => {
      if (document.hidden) abortForEnvironmentChange()
    }
    window.addEventListener('resize', abortForEnvironmentChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('resize', abortForEnvironmentChange)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [clearTransition, stopAnimations])

  const transitionPair = useMemo(
    () =>
      transition ? { sourceIndex: transition.sourceIndex, targetIndex: transition.targetIndex, progress } : undefined,
    [progress, transition]
  )
  const transitionDirection: -1 | 1 = transition && targetBaseRef.current < 0 ? -1 : 1
  const sourcePagePresentation = useMemo<AndroidPagerPagePresentation>(
    () => ({
      role: 'source',
      transitioning: Boolean(transition),
      direction: transitionDirection,
      progress: transition ? progress : undefined,
    }),
    [progress, transition, transitionDirection]
  )
  const targetPagePresentation = useMemo<AndroidPagerPagePresentation>(
    () => ({
      role: 'target',
      transitioning: true,
      direction: transitionDirection,
      progress,
    }),
    [progress, transitionDirection]
  )

  return (
    <>
      <div
        ref={trackRef}
        className="yachiyo-mobile-content yachiyo-main-tab-pager"
        data-phase={phase}
        data-reduced-motion={reducedMotion ? 'true' : 'false'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishPointerGesture(event)}
        onPointerCancel={(event) => finishPointerGesture(event, true)}
        onLostPointerCapture={(event) => finishPointerGesture(event, true)}
      >
        <motion.div
          className="yachiyo-main-tab-page yachiyo-main-tab-page-source"
          style={{ transform: sourceTransform, opacity: sourceOpacity }}
        >
          <AndroidPagerPagePresentationProvider value={sourcePagePresentation}>
            {renderSource ? renderSource(sourceActivity) : children}
          </AndroidPagerPagePresentationProvider>
        </motion.div>
        {transition && (
          <motion.div
            className="yachiyo-main-tab-page yachiyo-main-tab-page-target"
            style={{ transform: targetTransform, opacity: targetOpacity }}
            aria-hidden="true"
            ref={(node) => {
              if (node) node.inert = true
            }}
          >
            <AndroidPagerPagePresentationProvider value={targetPagePresentation}>
              {renderPreview(transition.targetTab)}
            </AndroidPagerPagePresentationProvider>
          </motion.div>
        )}
        {transition && (
          <motion.span
            className="yachiyo-main-tab-seam"
            style={{ opacity: progress, transform: seamTransform }}
            aria-hidden
          />
        )}
      </div>
      <AndroidBottomNavigation
        activeTab={activeTab}
        items={items}
        onChange={requestTab}
        presentationIndex={presentationIndex}
        transition={transitionPair}
        reducedMotion={Boolean(reducedMotion)}
      />
    </>
  )
}

export type AndroidPagerPresentationIndex = MotionValue<number>
