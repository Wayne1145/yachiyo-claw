import { describe, expect, it } from 'vitest'
import { AgentLoopGuard } from './agent-loop-guard'

const toolStep = (name: string, input: unknown, output: unknown) => ({
  text: '',
  toolCalls: [{ toolName: name, input }],
  toolResults: [{ toolName: name, output }],
})

describe('AgentLoopGuard', () => {
  it('detects repeated completed assistant output but ignores streaming-like partial progress', () => {
    const guard = new AgentLoopGuard()
    expect(guard.observeCompletedStep({ text: 'Downloaded 10 percent' })).toBeNull()
    expect(guard.observeCompletedStep({ text: 'Downloaded 50 percent' })).toBeNull()
    expect(guard.observeCompletedStep({ text: 'Downloaded 100 percent' })).toBeNull()

    expect(guard.observeCompletedStep({ text: 'I will retry the same operation now.' })).toBeNull()
    expect(guard.observeCompletedStep({ text: 'I will retry the same operation now.' })).toBeNull()
    expect(guard.observeCompletedStep({ text: 'I will retry the same operation now.' })?.reason).toBe(
      'assistant_repetition',
    )
  })

  it('detects identical tool parameters and repeated observations', () => {
    const guard = new AgentLoopGuard()
    expect(guard.observeCompletedStep(toolStep('android_observe', { mode: 'tree' }, { screen: 'home' }))).toBeNull()
    expect(guard.observeCompletedStep(toolStep('android_observe', { mode: 'tree' }, { screen: 'home' }))).toBeNull()
    expect(
      guard.observeCompletedStep(toolStep('android_observe', { mode: 'tree' }, { screen: 'home' }))?.reason,
    ).toBe('observation_repetition')
  })

  it('detects A-B-A-B oscillation', () => {
    const guard = new AgentLoopGuard()
    guard.observeCompletedStep(toolStep('tap', { x: 1 }, { screen: 'a' }))
    guard.observeCompletedStep(toolStep('tap', { x: 2 }, { screen: 'b' }))
    guard.observeCompletedStep(toolStep('tap', { x: 1 }, { screen: 'a' }))
    expect(guard.observeCompletedStep(toolStep('tap', { x: 2 }, { screen: 'b' }))?.reason).toBe('oscillation')
  })

  it('supports continue-once and a one-shot strategy instruction', () => {
    const guard = new AgentLoopGuard()
    const repeated = { text: 'same completed answer' }
    guard.observeCompletedStep(repeated)
    guard.observeCompletedStep(repeated)
    expect(guard.observeCompletedStep(repeated)).not.toBeNull()
    guard.continueOnce()
    expect(guard.observeCompletedStep(repeated)).toBeNull()

    guard.changeStrategy()
    expect(guard.takeStrategyInstruction()).toContain('materially different strategy')
    expect(guard.takeStrategyInstruction()).toBeNull()
  })

  it('canonicalizes tool arguments so object key order does not hide a loop', () => {
    const guard = new AgentLoopGuard()
    guard.observeCompletedStep(toolStep('shell', { command: 'pwd', cwd: '.' }, 'same'))
    guard.observeCompletedStep(toolStep('shell', { cwd: '.', command: 'pwd' }, 'same'))
    expect(guard.observeCompletedStep(toolStep('shell', { command: 'pwd', cwd: '.' }, 'same'))?.reason).toBe(
      'observation_repetition',
    )
  })
})
