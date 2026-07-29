import { describe, expect, it } from 'vitest'
import { resolveApprovedCharacterTint, resolveFlowGlassEnvironment } from './flow-glass-environment'

describe('flow glass environment mapping', () => {
  it.each([
    ['/', 'chat'],
    ['/session/abc', 'chat'],
    ['/interactive', 'interactive'],
    ['/task/abc', 'tasks'],
    ['/tasks', 'tasks'],
    ['/develop', 'tasks'],
    ['/develop/project-1', 'tasks'],
    ['/workspace/tasks', 'tasks'],
    ['/about', 'settings'],
    ['/settings/provider', 'settings'],
    ['/plugin/example', 'settings'],
  ] as const)('maps %s to %s', (pathname, expected) => {
    expect(resolveFlowGlassEnvironment(pathname)).toBe(expected)
  })

  it('uses only stable approved character tints', () => {
    expect(resolveApprovedCharacterTint('avatar-a')).toBe(resolveApprovedCharacterTint('avatar-a'))
    expect(resolveApprovedCharacterTint('avatar-a')).not.toBe(resolveApprovedCharacterTint('avatar-b'))
    expect(resolveApprovedCharacterTint(undefined)).toBe('transparent')
  })
})
