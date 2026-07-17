import {
  TASK_SANDBOX_DENY_READ_PATHS,
  TASK_SANDBOX_DENY_WRITE_PATHS,
  TASK_SANDBOX_EXTRA_WRITE_PATHS,
} from '@shared/task-sandbox'
import { describe, expect, it } from 'vitest'
import { buildTaskSystemPrompt } from './taskSystemPrompt'

describe('buildTaskSystemPrompt', () => {
  it('includes writable working directory and /tmp permissions', () => {
    const prompt = buildTaskSystemPrompt('/work/project')

    expect(prompt).toContain('Working directory: /work/project')
    expect(prompt).toContain(`Writable paths: /work/project, ${TASK_SANDBOX_EXTRA_WRITE_PATHS.join(', ')}`)
  })

  it('includes blocked read and write paths from sandbox policy', () => {
    const prompt = buildTaskSystemPrompt('/work/project')

    expect(prompt).toContain(`Blocked read paths: ${TASK_SANDBOX_DENY_READ_PATHS.join(', ')}`)
    expect(prompt).toContain(`Blocked write paths: ${TASK_SANDBOX_DENY_WRITE_PATHS.join(', ')}`)
  })

  it('instructs the model to ask the user for global or system-level actions', () => {
    const prompt = buildTaskSystemPrompt('/work/project')

    expect(prompt).toContain('If a requested action requires global or system-level changes')
    expect(prompt).toContain('Ask the user to run the required commands')
  })

  it('allows authorized Android actions while keeping identity separate from runtime policy', () => {
    const prompt = buildTaskSystemPrompt('/storage/emulated/0/Documents', {
      agentIdentity: '<agent_soul>Yachiyo</agent_soul>',
      deviceAgent: true,
    })

    expect(prompt).toContain('<agent_soul>Yachiyo</agent_soul>')
    expect(prompt).toContain('<agent_operating_instructions>')
    expect(prompt).toContain('The selected Soul controls personality and presentation only')
    expect(prompt).toContain('call android_device_info')
    expect(prompt).toContain('call android_observe')
    expect(prompt).toContain('Only report that access is unavailable after the appropriate tool actually fails')
    expect(prompt).toContain('Use the available Android device tools')
    expect(prompt).not.toContain('Ask the user to run the required commands')
  })

  it('does not add Android operating instructions to a non-device agent', () => {
    const prompt = buildTaskSystemPrompt('/work/project', {
      agentIdentity: '<agent_soul>Yachiyo</agent_soul>',
    })

    expect(prompt).toContain('<agent_soul>Yachiyo</agent_soul>')
    expect(prompt).not.toContain('<agent_operating_instructions>')
    expect(prompt).not.toContain('android_device_info')
  })
})
