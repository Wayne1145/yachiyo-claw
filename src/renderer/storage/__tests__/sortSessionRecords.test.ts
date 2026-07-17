import { describe, expect, it } from 'vitest'
import type { SessionMetaRecord } from '@shared/types'
import { sortSessionRecords } from '../SessionMetaStorage'

function makeRecord(overrides: Partial<SessionMetaRecord> & { id: string; sortOrder: number }): SessionMetaRecord {
  return {
    name: 'Test',
    createdAt: Date.now(),
    ...overrides,
  }
}

describe('sortSessionRecords', () => {
  it('returns empty array for empty input', () => {
    expect(sortSessionRecords([])).toEqual([])
  })

  it('sorts by sortOrder descending', () => {
    const records = [
      makeRecord({ id: 'a', sortOrder: 100 }),
      makeRecord({ id: 'b', sortOrder: 300 }),
      makeRecord({ id: 'c', sortOrder: 200 }),
    ]
    expect(sortSessionRecords(records).map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('puts starred first, then non-starred by sortOrder', () => {
    const records = [
      makeRecord({ id: 'r1', sortOrder: 400 }),
      makeRecord({ id: 'p1', sortOrder: 100, starred: true }),
      makeRecord({ id: 'r2', sortOrder: 200 }),
      makeRecord({ id: 'p2', sortOrder: 300, starred: true }),
    ]
    expect(sortSessionRecords(records).map((r) => r.id)).toEqual(['p2', 'p1', 'r1', 'r2'])
  })

  it('filters out hidden records', () => {
    const records = [
      makeRecord({ id: 'visible', sortOrder: 100 }),
      makeRecord({ id: 'hidden', sortOrder: 200, hidden: true }),
    ]
    const result = sortSessionRecords(records)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('visible')
  })
})

describe('reorder algorithm (fractional indexing)', () => {
  function computeNewSortOrder(sessions: SessionMetaRecord[], oldIndex: number, newIndex: number): number | null {
    const movedSession = sessions[oldIndex]
    if (!movedSession || oldIndex === newIndex) return null

    const remaining = sessions.filter((_, i) => i !== oldIndex)
    if (remaining.length === 0) return null

    if (newIndex <= 0) {
      return remaining[0].sortOrder + 1000
    } else if (newIndex >= remaining.length) {
      return remaining[remaining.length - 1].sortOrder - 1000
    } else {
      const before = remaining[newIndex - 1]
      const after = remaining[newIndex]
      return (before.sortOrder + after.sortOrder) / 2
    }
  }

  it('move to top', () => {
    const sessions = [
      makeRecord({ id: 'a', sortOrder: 3000 }),
      makeRecord({ id: 'b', sortOrder: 2000 }),
      makeRecord({ id: 'c', sortOrder: 1000 }),
    ]
    const result = computeNewSortOrder(sessions, 2, 0)
    expect(result).toBe(4000) // remaining[0].sortOrder (3000) + 1000
  })

  it('move to bottom', () => {
    const sessions = [
      makeRecord({ id: 'a', sortOrder: 3000 }),
      makeRecord({ id: 'b', sortOrder: 2000 }),
      makeRecord({ id: 'c', sortOrder: 1000 }),
    ]
    const result = computeNewSortOrder(sessions, 0, 2)
    // remaining after removing a: [b:2000, c:1000]
    // newIndex=2 >= remaining.length=2, so bottom
    expect(result).toBe(0) // remaining[last].sortOrder (1000) - 1000
  })

  it('move to middle', () => {
    const sessions = [
      makeRecord({ id: 'a', sortOrder: 3000 }),
      makeRecord({ id: 'b', sortOrder: 2000 }),
      makeRecord({ id: 'c', sortOrder: 1000 }),
    ]
    // Move c (index 2) to between a and b (newIndex 1)
    const result = computeNewSortOrder(sessions, 2, 1)
    // remaining: [a:3000, b:2000], newIndex=1 → (3000 + 2000) / 2
    expect(result).toBe(2500)
  })

  it('boundary: oldIndex=0 newIndex=1', () => {
    const sessions = [
      makeRecord({ id: 'a', sortOrder: 3000 }),
      makeRecord({ id: 'b', sortOrder: 2000 }),
      makeRecord({ id: 'c', sortOrder: 1000 }),
    ]
    // Move a (index 0) to index 1
    const result = computeNewSortOrder(sessions, 0, 1)
    // remaining: [b:2000, c:1000], newIndex=1 → (2000 + 1000) / 2
    expect(result).toBe(1500)
  })

  it('boundary: move last to first', () => {
    const sessions = [makeRecord({ id: 'a', sortOrder: 3000 }), makeRecord({ id: 'b', sortOrder: 2000 })]
    const result = computeNewSortOrder(sessions, 1, 0)
    // remaining: [a:3000], newIndex=0 → 3000 + 1000
    expect(result).toBe(4000)
  })

  it('same index returns null', () => {
    const sessions = [makeRecord({ id: 'a', sortOrder: 1000 })]
    expect(computeNewSortOrder(sessions, 0, 0)).toBeNull()
  })

  it('precision after 50 reorders between adjacent items', () => {
    let low = 1000
    let high = 2000
    for (let i = 0; i < 50; i++) {
      const mid = (low + high) / 2
      expect(mid).toBeGreaterThan(low)
      expect(mid).toBeLessThan(high)
      high = mid
    }
    // After 50 halvings, the gap should still be a valid distinct number
    expect(high).toBeGreaterThan(low)
    expect(high - low).toBeGreaterThan(0)
  })
})
