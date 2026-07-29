import {
  type PointerEventHandler,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

export type AdaptiveControlDensity = 'comfortable' | 'compact' | 'overflow'

export const ADAPTIVE_CONTROL_RECOVERY_MARGIN_PX = 12

export interface AdaptiveControlMeasurement {
  clientWidth: number
  scrollWidth: number
}

export type AdaptiveControlWidthRequirements = Partial<Record<AdaptiveControlDensity, number>>

export interface ResolveAdaptiveControlDensityOptions {
  density: AdaptiveControlDensity
  measurement: AdaptiveControlMeasurement
  requiredWidths: AdaptiveControlWidthRequirements
  recoveryMargin?: number
}

const densityOrder: AdaptiveControlDensity[] = ['comfortable', 'compact', 'overflow']

/**
 * Density changes are based on rendered geometry. Recovery deliberately needs
 * extra room so controls do not oscillate when font metrics land on a boundary.
 */
export function resolveAdaptiveControlDensity({
  density,
  measurement,
  requiredWidths,
  recoveryMargin = ADAPTIVE_CONTROL_RECOVERY_MARGIN_PX,
}: ResolveAdaptiveControlDensityOptions): AdaptiveControlDensity {
  const { clientWidth, scrollWidth } = measurement
  if (clientWidth <= 0) {
    return density
  }

  if (scrollWidth > clientWidth) {
    const index = densityOrder.indexOf(density)
    return densityOrder[Math.min(index + 1, densityOrder.length - 1)]
  }

  const index = densityOrder.indexOf(density)
  if (index === 0) {
    return density
  }

  const denser = densityOrder[index - 1]
  const denserRequiredWidth = requiredWidths[denser]
  if (denserRequiredWidth !== undefined && clientWidth >= denserRequiredWidth + recoveryMargin) {
    return denser
  }

  return density
}

export interface UseAdaptiveControlDensityResult<T extends HTMLElement> {
  containerRef: RefObject<T>
  density: AdaptiveControlDensity
  measurement: AdaptiveControlMeasurement
  pointerActive: boolean
  pointerHandlers: {
    onPointerDownCapture: PointerEventHandler<T>
    onPointerUpCapture: PointerEventHandler<T>
    onPointerCancelCapture: PointerEventHandler<T>
    onLostPointerCaptureCapture: PointerEventHandler<T>
  }
  measure: () => void
}

export interface UseAdaptiveControlDensityOptions {
  /** A stable signature for content whose intrinsic width may change. */
  contentKey?: unknown
}

const emptyMeasurement: AdaptiveControlMeasurement = {
  clientWidth: 0,
  scrollWidth: 0,
}

export function useAdaptiveControlDensity<T extends HTMLElement = HTMLDivElement>({
  contentKey,
}: UseAdaptiveControlDensityOptions = {}): UseAdaptiveControlDensityResult<T> {
  const containerRef = useRef<T>(null)
  const densityRef = useRef<AdaptiveControlDensity>('comfortable')
  const requiredWidthsRef = useRef<AdaptiveControlWidthRequirements>({})
  const pointerIdsRef = useRef(new Set<number>())
  const pendingMeasurementRef = useRef(false)
  const pendingReprobeRef = useRef(false)
  const contentKeyRef = useRef(contentKey)
  const contentKeyMountedRef = useRef(false)
  const [density, setDensity] = useState<AdaptiveControlDensity>('comfortable')
  const [measurement, setMeasurement] = useState<AdaptiveControlMeasurement>(emptyMeasurement)
  const [pointerActive, setPointerActive] = useState(false)

  densityRef.current = density

  const measure = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const nextMeasurement = {
      clientWidth: container.clientWidth,
      scrollWidth: container.scrollWidth,
    }

    setMeasurement((previous) =>
      previous.clientWidth === nextMeasurement.clientWidth && previous.scrollWidth === nextMeasurement.scrollWidth
        ? previous
        : nextMeasurement
    )

    if (nextMeasurement.clientWidth <= 0) {
      return
    }

    requiredWidthsRef.current[densityRef.current] = nextMeasurement.scrollWidth

    if (pointerIdsRef.current.size > 0) {
      pendingMeasurementRef.current = true
      return
    }

    const nextDensity = resolveAdaptiveControlDensity({
      density: densityRef.current,
      measurement: nextMeasurement,
      requiredWidths: requiredWidthsRef.current,
    })

    if (nextDensity !== densityRef.current) {
      densityRef.current = nextDensity
      setDensity(nextDensity)
    }
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [density, measure])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [measure])

  const requestHigherDensityProbe = useCallback(() => {
    requiredWidthsRef.current = {}
    if (pointerIdsRef.current.size > 0) {
      pendingReprobeRef.current = true
      return
    }

    pendingReprobeRef.current = false
    if (densityRef.current === 'comfortable') {
      measure()
      return
    }

    densityRef.current = 'comfortable'
    setDensity('comfortable')
  }, [measure])

  useLayoutEffect(() => {
    if (!contentKeyMountedRef.current) {
      contentKeyMountedRef.current = true
      contentKeyRef.current = contentKey
      return
    }
    if (Object.is(contentKeyRef.current, contentKey)) {
      return
    }

    contentKeyRef.current = contentKey
    requestHigherDensityProbe()
  }, [contentKey, requestHigherDensityProbe])

  const releasePointer = useCallback(
    (pointerId: number) => {
      pointerIdsRef.current.delete(pointerId)
      if (pointerIdsRef.current.size > 0) {
        return
      }

      setPointerActive(false)
      if (pendingMeasurementRef.current) {
        pendingMeasurementRef.current = false
      }
      if (pendingReprobeRef.current) {
        requestHigherDensityProbe()
        return
      }
      measure()
    },
    [measure, requestHigherDensityProbe]
  )

  const onPointerDownCapture = useCallback<PointerEventHandler<T>>((event) => {
    pointerIdsRef.current.add(event.pointerId)
    setPointerActive(true)
  }, [])

  const onPointerUpCapture = useCallback<PointerEventHandler<T>>(
    (event) => releasePointer(event.pointerId),
    [releasePointer]
  )
  const onPointerCancelCapture = useCallback<PointerEventHandler<T>>(
    (event) => releasePointer(event.pointerId),
    [releasePointer]
  )
  const onLostPointerCaptureCapture = useCallback<PointerEventHandler<T>>(
    (event) => releasePointer(event.pointerId),
    [releasePointer]
  )

  useLayoutEffect(() => {
    if (!pointerActive) {
      return
    }

    const releaseOutsideContainer = (event: PointerEvent) => releasePointer(event.pointerId)
    document.addEventListener('pointerup', releaseOutsideContainer, true)
    document.addEventListener('pointercancel', releaseOutsideContainer, true)
    return () => {
      document.removeEventListener('pointerup', releaseOutsideContainer, true)
      document.removeEventListener('pointercancel', releaseOutsideContainer, true)
    }
  }, [pointerActive, releasePointer])

  return {
    containerRef,
    density,
    measurement,
    pointerActive,
    pointerHandlers: {
      onPointerDownCapture,
      onPointerUpCapture,
      onPointerCancelCapture,
      onLostPointerCaptureCapture,
    },
    measure,
  }
}
