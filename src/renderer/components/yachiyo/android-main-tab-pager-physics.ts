export const ANDROID_PAGER_INTENT_SLOP_PX = 10
export const ANDROID_PAGER_AXIS_RATIO = 1.25
export const ANDROID_PAGER_SAMPLE_WINDOW_MS = 80
export const ANDROID_PAGER_MAX_SAMPLES = 5
export const ANDROID_PAGER_MAX_VELOCITY_PX_S = 2500
export const ANDROID_PAGER_COMMIT_PROGRESS = 0.33
export const ANDROID_PAGER_FLICK_VELOCITY_PX_S = 650
export const ANDROID_PAGER_FLICK_DISTANCE_PX = 18
export const ANDROID_PAGER_DECELERATION_RATE = 0.99
export const ANDROID_PAGER_RUBBER_BAND_CONSTANT = 0.45
export const ANDROID_PAGER_MAX_VISUAL_OVERSHOOT_PX = 2

export type AndroidPagerAxisDecision = 'pending' | 'horizontal' | 'vertical'

export interface AndroidPagerPositionSample {
  position: number
  time: number
}

export function resolveAndroidPagerAxis(dx: number, dy: number): AndroidPagerAxisDecision {
  const absoluteX = Math.abs(dx)
  const absoluteY = Math.abs(dy)
  if (Math.max(absoluteX, absoluteY) < ANDROID_PAGER_INTENT_SLOP_PX) return 'pending'
  if (absoluteX >= ANDROID_PAGER_INTENT_SLOP_PX && absoluteX >= absoluteY * ANDROID_PAGER_AXIS_RATIO) {
    return 'horizontal'
  }
  return 'vertical'
}

export function appendAndroidPagerSample(
  samples: readonly AndroidPagerPositionSample[],
  sample: AndroidPagerPositionSample
): AndroidPagerPositionSample[] {
  return [...samples, sample]
    .filter((candidate) => sample.time - candidate.time <= ANDROID_PAGER_SAMPLE_WINDOW_MS)
    .slice(-ANDROID_PAGER_MAX_SAMPLES)
}

export function estimateAndroidPagerVelocity(samples: readonly AndroidPagerPositionSample[]): number {
  if (samples.length < 2) return 0
  const origin = samples[0].time
  const points = samples.map((sample) => ({ x: sample.time - origin, y: sample.position }))
  const meanX = points.reduce((total, point) => total + point.x, 0) / points.length
  const meanY = points.reduce((total, point) => total + point.y, 0) / points.length
  const denominator = points.reduce((total, point) => total + (point.x - meanX) ** 2, 0)
  if (denominator === 0) return 0
  const numerator = points.reduce((total, point) => total + (point.x - meanX) * (point.y - meanY), 0)
  const velocity = (numerator / denominator) * 1000
  return Math.max(-ANDROID_PAGER_MAX_VELOCITY_PX_S, Math.min(ANDROID_PAGER_MAX_VELOCITY_PX_S, velocity))
}

export function projectAndroidPagerOffset(offset: number, velocity: number): number {
  return offset + (velocity / 1000) * (ANDROID_PAGER_DECELERATION_RATE / (1 - ANDROID_PAGER_DECELERATION_RATE))
}

export function shouldCommitAndroidPagerTransition({
  offset,
  velocity,
  width,
}: {
  offset: number
  velocity: number
  width: number
}): boolean {
  if (width <= 0 || offset === 0) return false
  const sameDirection = velocity === 0 || Math.sign(velocity) === Math.sign(offset)
  const projectedOffset = projectAndroidPagerOffset(offset, velocity)
  const projectedProgress = Math.sign(projectedOffset) === Math.sign(offset) ? Math.abs(projectedOffset) / width : 0
  const explicitFlick =
    sameDirection &&
    Math.abs(velocity) >= ANDROID_PAGER_FLICK_VELOCITY_PX_S &&
    Math.abs(offset) >= ANDROID_PAGER_FLICK_DISTANCE_PX
  return projectedProgress >= ANDROID_PAGER_COMMIT_PROGRESS || explicitFlick
}

export function clampAndroidPagerVisualOffset(
  offset: number,
  targetOffset: number,
  maxOvershoot = ANDROID_PAGER_MAX_VISUAL_OVERSHOOT_PX
): number {
  const lowerBound = Math.min(0, targetOffset) - maxOvershoot
  const upperBound = Math.max(0, targetOffset) + maxOvershoot
  return Math.max(lowerBound, Math.min(upperBound, offset))
}

export function rubberBandAndroidPagerOffset(
  overshoot: number,
  dimension: number,
  constant = ANDROID_PAGER_RUBBER_BAND_CONSTANT
): number {
  if (dimension <= 0 || overshoot === 0) return 0
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

export function androidPagerIndexDeltaForOffset(offset: number, rtl: boolean): -1 | 0 | 1 {
  if (offset === 0) return 0
  const visualDirection = offset < 0 ? 1 : -1
  return (rtl ? -visualDirection : visualDirection) as -1 | 1
}

export function resolveAndroidPagerTargetIndex({
  sourceIndex,
  offset,
  itemCount,
  rtl,
}: {
  sourceIndex: number
  offset: number
  itemCount: number
  rtl: boolean
}): number | undefined {
  const delta = androidPagerIndexDeltaForOffset(offset, rtl)
  if (delta === 0) return undefined
  const target = sourceIndex + delta
  return target >= 0 && target < itemCount ? target : undefined
}
