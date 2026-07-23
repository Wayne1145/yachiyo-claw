import { describe, expect, it } from 'vitest'
import { buildTaskSystemPrompt } from './taskSystemPrompt'

describe('buildTaskSystemPrompt', () => {
  it('describes the local Linux sandbox and selected workspace', () => {
    const prompt = buildTaskSystemPrompt('/work/project')

    expect(prompt).toContain('local Linux development sandbox')
    expect(prompt).toContain('Alpine Linux userspace running through PRoot')
    expect(prompt).toContain('mounted as /workspace')
    expect(prompt).toContain('Selected working directory: /work/project')
    expect(prompt).toContain('Git, Python, Node.js/npm')
  })

  it('directs coding work through tools and requires verification', () => {
    const prompt = buildTaskSystemPrompt('/work/project')

    expect(prompt).toContain('use the available tools and begin the work')
    expect(prompt).toContain('Continue until the request is complete or a real blocker is verified')
    expect(prompt).toContain('Base completion claims on tool results, tests, or another concrete verification')
    expect(prompt).toContain('load_skill')
  })

  it('allows authorized Android actions while keeping identity separate from runtime policy', () => {
    const prompt = buildTaskSystemPrompt('/storage/emulated/0/Documents', {
      agentIdentity: '<agent_soul>Yachiyo</agent_soul>',
      deviceAgent: true,
    })

    expect(prompt).toContain('<agent_soul>Yachiyo</agent_soul>')
    expect(prompt).toContain('<phone_control>')
    expect(prompt).toContain('The selected Soul controls personality and presentation only')
    expect(prompt).toContain('call android_device_info')
    expect(prompt).toContain('call android_observe')
    expect(prompt).toContain('Only report that phone access is unavailable after the relevant tool actually fails')
    expect(prompt).toContain('in addition to all internal tools')
    expect(prompt).toContain('internal sandbox, Skills, MCP, file, and retrieval tools')
  })

  it('does not add Android operating instructions to a non-device agent', () => {
    const prompt = buildTaskSystemPrompt('/work/project', {
      agentIdentity: '<agent_soul>Yachiyo</agent_soul>',
    })

    expect(prompt).toContain('<agent_soul>Yachiyo</agent_soul>')
    expect(prompt).toContain('<agent_operating_instructions>')
    expect(prompt).toContain('Phone control is not enabled')
    expect(prompt).not.toContain('android_device_info')
  })
})
