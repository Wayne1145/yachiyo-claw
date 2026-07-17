/**
 * Confetti - Celebration animation effects
 *
 * Simple API:
 *   import { confetti } from '@/components/Confetti'
 *   confetti()              // default celebration
 *   confetti('burst')       // single burst
 *   confetti('fireworks')   // fireworks effect
 *   confetti({ ... })       // custom options
 */

import canvasConfetti from 'canvas-confetti'

/** Track active intervals for cleanup */
let activeIntervals: Set<ReturnType<typeof setInterval>> = new Set()

/** Preset effect types */
export type ConfettiPreset = 'default' | 'burst' | 'fireworks'

/** Custom confetti options */
export interface ConfettiOptions {
  /** Number of particles (default: 100) */
  particleCount?: number
  /** Spread angle in degrees (default: 70) */
  spread?: number
  /** Origin point { x: 0-1, y: 0-1 } */
  origin?: { x?: number; y?: number }
  /** Animation duration in ms (default: 3000, only for 'default' preset) */
  duration?: number
  /** Colors array (default: confetti default colors) */
  colors?: string[]
}

/**
 * Fire confetti animation
 * @param presetOrOptions - Preset name or custom options
 *
 * @example
 * // Preset effects
 * confetti()              // Default celebration from both sides
 * confetti('burst')       // Single center burst
 * confetti('fireworks')   // Fireworks effect
 *
 * // Custom options
 * confetti({ particleCount: 200, spread: 100 })
 */
export function confetti(presetOrOptions?: ConfettiPreset | ConfettiOptions): void {
  if (typeof presetOrOptions === 'string') {
    firePreset(presetOrOptions)
  } else if (presetOrOptions) {
    fireCustom(presetOrOptions)
  } else {
    firePreset('default')
  }
}

/** Fire a preset effect */
function firePreset(preset: ConfettiPreset): void {
  switch (preset) {
    case 'burst':
      fireBurst()
      break
    case 'fireworks':
      fireFireworks()
      break
    case 'default':
    default:
      fireCelebration()
      break
  }
}

/** Fire custom confetti */
function fireCustom(options: ConfettiOptions): void {
  canvasConfetti({
    particleCount: options.particleCount ?? 100,
    spread: options.spread ?? 70,
    origin: { x: options.origin?.x ?? 0.5, y: options.origin?.y ?? 0.6 },
    colors: options.colors,
    zIndex: 9999,
  })
}

/** Default celebration - continuous from both sides */
function fireCelebration(duration = 3000): void {
  const animationEnd = Date.now() + duration
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 }

  const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now()
    if (timeLeft <= 0) {
      clearInterval(interval)
      activeIntervals.delete(interval)
      return
    }

    const particleCount = 50 * (timeLeft / duration)

    // Fire from left
    canvasConfetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
    })

    // Fire from right
    canvasConfetti({
      ...defaults,
      particleCount,
      origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
    })
  }, 250)

  activeIntervals.add(interval)
}

/** Single burst from center */
function fireBurst(): void {
  canvasConfetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    zIndex: 9999,
  })
}

/** Fireworks effect */
function fireFireworks(): void {
  const duration = 2000
  const animationEnd = Date.now() + duration
  const defaults = { startVelocity: 45, spread: 360, ticks: 50, zIndex: 9999 }

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now()
    if (timeLeft <= 0) {
      clearInterval(interval)
      activeIntervals.delete(interval)
      return
    }

    canvasConfetti({
      ...defaults,
      particleCount: 30,
      origin: { x: Math.random(), y: Math.random() * 0.4 },
    })
  }, 200)

  activeIntervals.add(interval)
}

/**
 * Cancel all active confetti animations
 * Call this when navigating away or unmounting components that triggered confetti
 */
export function cancelConfetti(): void {
  for (const interval of activeIntervals) {
    clearInterval(interval)
  }
  activeIntervals.clear()
  // Also reset the canvas-confetti instance to free memory
  canvasConfetti.reset()
}

// Default export for convenient importing
export default confetti
