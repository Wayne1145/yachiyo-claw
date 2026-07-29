import { describe, expect, it } from 'vitest'
import { resolveMobileComposerPrimaryMode } from './mobile-primary-action'

describe('resolveMobileComposerPrimaryMode', () => {
  it.each([
    [{ generating: true, speechRecording: true, speechProcessing: true, hasContent: true }, 'stop'],
    [{ generating: false, speechRecording: true, speechProcessing: true, hasContent: true }, 'recording'],
    [{ generating: false, speechRecording: false, speechProcessing: true, hasContent: true }, 'processing'],
    [{ generating: false, speechRecording: false, speechProcessing: false, hasContent: true }, 'send'],
    [{ generating: false, speechRecording: false, speechProcessing: false, hasContent: false }, 'speech'],
  ] as const)('resolves %o to %s', (state, expected) => {
    expect(resolveMobileComposerPrimaryMode(state)).toBe(expected)
  })
})
