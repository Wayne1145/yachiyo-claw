import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { selectAndroidActiveTools, selectAndroidToolStage } from './android-tool-stages'

function message(role: ModelMessage['role'], text: string): ModelMessage {
  return { role, content: [{ type: 'text', text }] } as ModelMessage
}

describe('Android tool stages', () => {
  it('starts with observation and structured launch tools only', () => {
    expect(selectAndroidToolStage(0, [])).toBe('initial')
    expect(selectAndroidActiveTools(0, [])).toEqual([
      'android_device_info',
      'android_observe',
      'android_launch_app',
      'android_run_recipe',
    ])
  })

  it('opens semantic actions after the first step and coordinate fallback after a tool failure', () => {
    expect(selectAndroidActiveTools(1, [message('assistant', 'launch ok')])).toContain('android_click_node')
    expect(selectAndroidActiveTools(1, [message('tool', 'node_not_found')])).toContain('android_tap')
  })

  it('does not widen tool access because user or assistant text mentions an error', () => {
    const messages = [message('user', 'Fix an error in this app'), message('assistant', 'I will inspect the error')]
    expect(selectAndroidToolStage(0, messages)).toBe('initial')
    expect(selectAndroidToolStage(1, messages)).toBe('stable')
    expect(selectAndroidActiveTools(1, messages)).not.toContain('android_tap')
  })

  it('reduces the tool set after a verified tool result', () => {
    expect(selectAndroidActiveTools(2, [message('tool', 'recipe_verified')])).toEqual(['android_observe'])
  })

  it('keeps internal tools available while Android tools advance through stages', () => {
    const requested = ['sandbox_bash', 'load_skill', 'android_observe', 'android_launch_app']

    expect(selectAndroidActiveTools(1, [message('assistant', 'continue')], requested)).toEqual(
      expect.arrayContaining(['sandbox_bash', 'load_skill', 'android_click_node']),
    )
    expect(selectAndroidActiveTools(2, [message('tool', 'recipe_verified')], requested)).toEqual([
      'sandbox_bash',
      'load_skill',
      'android_observe',
    ])
  })
})
