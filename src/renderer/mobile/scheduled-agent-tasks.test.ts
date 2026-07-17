/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { calculateNextScheduledRunAt } from './scheduled-agent-tasks'

describe('scheduled agent tasks', () => {
  it('advances daily schedules beyond missed runs', () => {
    const day = 24 * 60 * 60 * 1000
    expect(calculateNextScheduledRunAt('daily', 1_000, 1_000 + day * 3)).toBe(1_000 + day * 4)
  })

  it('advances weekly schedules and leaves one-time schedules unchanged', () => {
    const week = 7 * 24 * 60 * 60 * 1000
    expect(calculateNextScheduledRunAt('weekly', 5_000, 5_000 + week)).toBe(5_000 + week * 2)
    expect(calculateNextScheduledRunAt('once', 5_000, 50_000)).toBe(5_000)
  })
})
