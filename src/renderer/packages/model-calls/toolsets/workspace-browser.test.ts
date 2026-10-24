import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ register: vi.fn(), open: vi.fn(), approve: vi.fn() }))
vi.mock('@/platform', () => ({
  default: { registerWorkspacePreview: mocks.register, openWorkspacePreview: mocks.open },
}))
vi.mock('@/mobile/agent-approval', () => ({
  getActiveAgentSession: () => 'test-session',
  requestAgentApproval: mocks.approve,
}))
import { workspaceBrowserToolSet } from './workspace-browser'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.register.mockResolvedValue({ success: true, id: 'preview', url: 'http://127.0.0.1:8080/' })
  mocks.approve.mockResolvedValue(false)
})
describe('workspace preview visibility', () => {
  it('does not steal the foreground for routine Agent browser testing', async () => {
    const result = await workspaceBrowserToolSet.tools.workspace_preview.execute!(
      { port: 8080, path: '/', open: false },
      { toolCallId: 'test', messages: [] }
    )
    expect(result).toMatchObject({ success: true, opened: false })
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.approve).not.toHaveBeenCalled()
  })
  it('requires approval before explicitly opening a visible preview', async () => {
    const execute = workspaceBrowserToolSet.tools.workspace_preview.execute!
    await execute({ port: 8080, path: '/', open: true }, { toolCallId: 'test', messages: [] })
    expect(mocks.open).not.toHaveBeenCalled()
    mocks.approve.mockResolvedValue(true)
    await execute({ port: 8080, path: '/', open: true }, { toolCallId: 'test2', messages: [] })
    expect(mocks.open).toHaveBeenCalledWith('preview')
  })
})
