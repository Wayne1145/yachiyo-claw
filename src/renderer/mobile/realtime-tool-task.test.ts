import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), getConfig: vi.fn(), copy: vi.fn(), save: vi.fn() }))
vi.mock('./conversation-bridge', () => ({ ensureAgentTaskForChat: mocks.ensure }))
vi.mock('./agent-session-config', () => ({
  getAgentSessionConfig: mocks.getConfig,
  copyAgentSessionConfig: mocks.copy,
  saveAgentSessionConfig: mocks.save,
}))
import { ensureRealtimeToolTask } from './realtime-tool-task'
describe('Realtime internal tools task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensure.mockResolvedValue({ id: 'task' })
    mocks.getConfig.mockReturnValue({ configured: false })
  })
  it('enables internal tools even when the previous mode was ordinary chat', async () => {
    expect(await ensureRealtimeToolTask('chat')).toBe('task')
    expect(mocks.ensure).toHaveBeenCalledWith('chat')
    expect(mocks.copy).toHaveBeenCalledWith('chat', 'task')
    expect(mocks.save).toHaveBeenCalledWith('task', { enabled: true, configured: true })
    expect(mocks.save.mock.calls[0][1]).not.toHaveProperty('deviceControlEnabled')
    expect(mocks.save.mock.calls[0][1]).not.toHaveProperty('approvalMode')
  })
  it('preserves existing task phone-control and approval configuration', async () => {
    mocks.getConfig.mockReturnValue({ configured: true, deviceControlEnabled: false, approvalMode: 'manual' })
    await ensureRealtimeToolTask('chat')
    expect(mocks.copy).not.toHaveBeenCalled()
    expect(mocks.save).toHaveBeenCalledWith('task', { enabled: true, configured: true })
  })
  it('does not enable anything if linking the conversation fails', async () => {
    mocks.ensure.mockRejectedValue(new Error('chat_session_not_found'))
    await expect(ensureRealtimeToolTask('missing')).rejects.toThrow('chat_session_not_found')
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
