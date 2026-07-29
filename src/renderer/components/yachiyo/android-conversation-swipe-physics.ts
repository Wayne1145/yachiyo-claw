export const ANDROID_HISTORY_SWIPE_INTENT_SLOP_PX = 10
export const ANDROID_HISTORY_SWIPE_AXIS_RATIO = 1.25
export const ANDROID_HISTORY_SWIPE_SAMPLE_WINDOW_MS = 80
export const ANDROID_HISTORY_SWIPE_MAX_SAMPLES = 5
export const ANDROID_HISTORY_SWIPE_MAX_VELOCITY_PX_S = 2500
export const ANDROID_HISTORY_SWIPE_COMMIT_PROGRESS = 0.33
export const ANDROID_HISTORY_SWIPE_FLICK_VELOCITY_PX_S = 650
export const ANDROID_HISTORY_SWIPE_FLICK_DISTANCE_PX = 18
export const ANDROID_HISTORY_SWIPE_DECELERATION_RATE = 0.99
export const ANDROID_HISTORY_SWIPE_RUBBER_BAND_CONSTANT = 0.45
export const ANDROID_HISTORY_ACTION_BUTTON_PX = 44
export const ANDROID_HISTORY_ACTION_GAP_PX = 6

export type AndroidHistorySwipeAxis = 'pending' | 'horizontal' | 'vertical'

export interface AndroidHistorySwipeSample {
  position: number
  time: number
}

export function getAndroidHistoryActionWidth(
  actionCount: number,
  buttonWidth = ANDROID_HISTORY_ACTION_BUTTON_PX,
  gap = ANDROID_HISTORY_ACTION_GAP_PX
): number {
  const count = Math.max(0, Math.floor(actionCount))
  return count === 0 ? 0 : count * buttonWidth + (count - 1) * gap
}

export function resolveAndroidHistorySwipeAxis(dx: number, dy: number): AndroidHistorySwipeAxis {
  const absoluteX = Math.abs(dx)
  const absoluteY = Math.abs(dy)
  if (Math.max(absoluteX, absoluteY) < ANDROID_HISTORY_SWIPE_INTENT_SLOP_PX) return 'pending'
  if (absoluteX >= ANDROID_HISTORY_SWIPE_INTENT_SLOP_PX && absoluteX >= absoluteY * ANDROID_HISTORY_SWIPE_AXIS_RATIO) {
    return 'horizontal'
  }
  return 'vertical'
}

export function appendAndroidHistorySwipeSample(
  samples: readonly AndroidHistorySwipeSample[],
  sample: AndroidHistorySwipeSample
): AndroidHistorySwipeSample[] {
  return [...samples, sample]
    .filter((candidate) => sample.time - candidate.time <= ANDROID_HISTORY_SWIPE_SAMPLE_WINDOW_MS)
    .slice(-ANDROID_HISTORY_SWIPE_MAX_SAMPLES)
}

export function estimateAndroidHistorySwipeVelocity(samples: readonly AndroidHistorySwipeSample[]): number {
  if (samples.length < 2) return 0
  const origin = samples[0].time
  const points = samples.map((sample) => ({ x: sample.time - origin, y: sample.position }))
  const meanX = points.reduce((total, point) => total + point.x, 0) / points.length
  const meanY = points.reduce((total, point) => total + point.y, 0) / points.length
  const denominator = points.reduce((total, point) => total + (point.x - meanX) ** 2, 0)
  if (denominator === 0) return 0
  const numerator = points.reduce((total, point) => total + (point.x - meanX) * (point.y - meanY), 0)
  const velocity = (numerator / denominator) * 1000
  return Math.max(-ANDROID_HISTORY_SWIPE_MAX_VELOCITY_PX_S, Math.min(ANDROID_HISTORY_SWIPE_MAX_VELOCITY_PX_S, velocity))
}

export function projectAndroidHistorySwipeOffset(offset: number, velocity: number): number {
  return (
    offset +
    (velocity / 1000) * (ANDROID_HISTORY_SWIPE_DECELERATION_RATE / (1 - ANDROID_HISTORY_SWIPE_DECELERATION_RATE))
  )
}

export function shouldToggleAndroidHistorySwipe({
  sourceOpen,
  startOffset,
  offset,
  velocity,
  actionWidth,
}: {
  sourceOpen: boolean
  startOffset: number
  offset: number
  velocity: number
  actionWidth: number
}): boolean {
  if (actionWidth <= 0) return false
  const direction = sourceOpen ? 1 : -1
  const actualTravel = (offset - startOffset) * direction
  const projectedTravel = (projectAndroidHistorySwipeOffset(offset, velocity) - startOffset) * direction
  const projectedCommit =
    actualTravel >= ANDROID_HISTORY_SWIPE_FLICK_DISTANCE_PX &&
    projectedTravel >= actionWidth * ANDROID_HISTORY_SWIPE_COMMIT_PROGRESS
  const flick =
    actualTravel >= ANDROID_HISTORY_SWIPE_FLICK_DISTANCE_PX &&
    velocity * direction >= ANDROID_HISTORY_SWIPE_FLICK_VELOCITY_PX_S

  return projectedCommit || flick
}

export function rubberBandAndroidHistoryOffset(
  proposedOffset: number,
  minimumOffset: number,
  maximumOffset: number,
  dimension: number
): number {
  if (proposedOffset >= minimumOffset && proposedOffset <= maximumOffset) return proposedOffset
  const boundary = proposedOffset < minimumOffset ? minimumOffset : maximumOffset
  const overshoot = proposedOffset - boundary
  const safeDimension = Math.max(1, dimension)
  return (
    boundary +
    (overshoot * safeDimension * ANDROID_HISTORY_SWIPE_RUBBER_BAND_CONSTANT) /
      (safeDimension + ANDROID_HISTORY_SWIPE_RUBBER_BAND_CONSTANT * Math.abs(overshoot))
  )
}
