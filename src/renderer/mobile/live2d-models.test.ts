import { describe, expect, it } from 'vitest'
import {
  buildLive2DActionPrompt,
  extractLive2DActions,
  hideValidLive2DMarkers,
  parseLive2DActionMarkers,
  validateLive2DArchiveLimits,
} from './live2d-models'

describe('Live2D action protocol', () => {
  const actions = extractLive2DActions({
    FileReferences: {
      Expressions: [{ Name: 'smile', File: 'smile.exp3.json' }],
      Motions: { Wave: [{ File: 'motions/wave.motion3.json' }] },
    },
  })

  it('extracts registered expression and motion names', () => {
    expect(actions).toEqual([
      { token: 'smile', kind: 'expression', expressionName: 'smile' },
      { token: 'Wave', kind: 'motion', motionGroup: 'Wave', motionIndex: 0 },
    ])
  })

  it('hides only valid markers from the live bubble', () => {
    const text = '[smile]你好。[unknown]再见。[Wave]'
    expect(hideValidLive2DMarkers(text, actions)).toBe('你好。[unknown]再见。')
    expect(parseLive2DActionMarkers(text, actions).map((event) => event.action.token)).toEqual(['smile', 'Wave'])
  })

  it('builds a prompt from the actual model catalog', () => {
    expect(buildLive2DActionPrompt(actions)).toContain('[smile]')
    expect(buildLive2DActionPrompt(actions)).toContain('[Wave]')
  })

  it('rejects archives that exceed resource limits', () => {
    expect(() => validateLive2DArchiveLimits(257 * 1024 * 1024, 1, 1)).toThrow('live2d_archive_too_large')
    expect(() => validateLive2DArchiveLimits(1, 2_001, 1)).toThrow('live2d_archive_too_many_files')
    expect(() => validateLive2DArchiveLimits(1, 1, 1024 * 1024 * 1024 + 1)).toThrow(
      'live2d_archive_uncompressed_too_large'
    )
  })
})
