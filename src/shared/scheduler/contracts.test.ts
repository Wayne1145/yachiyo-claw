import { describe, expect, it } from 'vitest'
import { canTransitionScheduleStatus, nextScheduleRunAt, normalizeScheduleSpec } from './contracts'

describe('scheduler contracts', () => {
  it('normalizes safe defaults while preserving an explicit schedule id', () => {
    expect(
      normalizeScheduleSpec({ id: ' schedule-1 ', title: '', prompt: '  check status  ', runAt: 100, repeat: 'once' })
    ).toEqual({
      id: 'schedule-1',
      title: 'check status',
      prompt: 'check status',
      runAt: 100,
      repeat: 'once',
      enabled: true,
      exact: false,
      requiresNetwork: false,
      timezone: 'UTC',
    })
  })

  it('advances repeating schedules beyond multiple missed intervals', () => {
    const day = 24 * 60 * 60 * 1000
    expect(nextScheduleRunAt('daily', 1_000, 1_000 + day * 3)).toBe(1_000 + day * 4)
  })

  it('allows lease recovery but not terminal resurrection', () => {
    expect(canTransitionScheduleStatus('claimed', 'awaiting-foreground')).toBe(true)
    expect(canTransitionScheduleStatus('retryable-failed', 'claimed')).toBe(true)
    expect(canTransitionScheduleStatus('succeeded', 'running')).toBe(false)
    expect(canTransitionScheduleStatus('cancelled', 'scheduled')).toBe(false)
  })
})

