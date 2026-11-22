import { describe, expect, it } from 'vitest'
import { resolveAndroidShellLayout } from './android-landscape-layout'

describe('Android shell layout', () => {
  it('keeps portrait chrome while a keyboard reduces usable height', () => {
    expect(resolveAndroidShellLayout(448, false)).toBe('portrait')
    expect(resolveAndroidShellLayout(800, false)).toBe('portrait')
  })

  it('preserves the full conversation pane on short-width landscape devices', () => {
    expect(resolveAndroidShellLayout(519, true)).toBe('portrait')
    expect(resolveAndroidShellLayout(550, true)).toBe('rail')
    expect(resolveAndroidShellLayout(719, true)).toBe('rail')
    expect(resolveAndroidShellLayout(720, true)).toBe('wide')
    expect(resolveAndroidShellLayout(960, true)).toBe('wide')
  })
})
