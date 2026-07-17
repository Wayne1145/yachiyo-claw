import { describe, expect, it } from 'vitest'

import type { SessionMeta } from '@shared/types'
import { sortSessionRecords } from '@/storage/SessionMetaStorage'

import { createSessionMetaRecordsFromLegacyList, sortSessions } from './session-utils'

describe('sortSessions', () => {
  it('returns empty array for empty input', () => {
    expect(sortSessions([])).toEqual([])
  })

  it('reverses regular sessions (newest first)', () => {
    const s1 = { id: 's1' } as unknown as SessionMeta
    const s2 = { id: 's2' } as unknown as SessionMeta
    const s3 = { id: 's3' } as unknown as SessionMeta

    expect(sortSessions([s1, s2, s3])).toEqual([s3, s2, s1])
  })

  it('puts starred sessions first', () => {
    const a = { id: 'a', starred: true } as unknown as SessionMeta
    const b = { id: 'b' } as unknown as SessionMeta
    const c = { id: 'c', starred: true } as unknown as SessionMeta

    expect(sortSessions([b, a, c])).toEqual([a, c, b])
  })

  it('filters out hidden sessions', () => {
    const visible = { id: 'visible' } as unknown as SessionMeta
    const hidden = { id: 'hidden', hidden: true } as unknown as SessionMeta

    expect(sortSessions([visible, hidden])).toEqual([visible])
  })

  it('handles mixed pinned + regular + hidden sessions', () => {
    const p1 = { id: 'p1', starred: true } as unknown as SessionMeta
    const r1 = { id: 'r1' } as unknown as SessionMeta
    const h1 = { id: 'h1', hidden: true } as unknown as SessionMeta
    const r2 = { id: 'r2' } as unknown as SessionMeta
    const p2 = { id: 'p2', starred: true } as unknown as SessionMeta

    expect(sortSessions([r1, p1, h1, r2, p2])).toEqual([p1, p2, r2, r1])
  })
})

describe('createSessionMetaRecordsFromLegacyList', () => {
  it('preserves legacy display order when records are sorted by sortOrder', () => {
    const justChat = { id: 'just-chat', name: 'Just chat', starred: true } as SessionMeta
    const markdown = { id: 'markdown', name: 'Markdown', starred: true } as SessionMeta
    const travel = { id: 'travel', name: 'Travel' } as SessionMeta
    const social = { id: 'social', name: 'Social' } as SessionMeta
    const software = { id: 'software', name: 'Software', starred: true } as SessionMeta
    const translator = { id: 'translator', name: 'Translator' } as SessionMeta

    const legacyList = [justChat, markdown, travel, social, software, translator]
    const records = createSessionMetaRecordsFromLegacyList(legacyList, 10_000)

    expect(sortSessionRecords(records).map((record) => record.id)).toEqual(
      sortSessions(legacyList).map((session) => session.id)
    )
    expect(sortSessionRecords(records).map((record) => record.id)).toEqual([
      'just-chat',
      'markdown',
      'software',
      'translator',
      'social',
      'travel',
    ])
  })
})
