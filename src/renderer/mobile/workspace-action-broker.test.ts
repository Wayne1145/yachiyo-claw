import { beforeEach, describe, expect, it, vi } from 'vitest'

const approval = vi.hoisted(() => vi.fn())
vi.mock('./agent-approval', () => ({ requestAgentApproval: approval }))

import { runWorkspaceBrokeredAction } from './workspace-action-broker'

describe('workspace action broker', () => {
  beforeEach(() => approval.mockReset())

  it('does not invoke a native mutation when approval is denied', async () => {
    approval.mockResolvedValue(false)
    const action = vi.fn()
    await expect(
      runWorkspaceBrokeredAction(
        { title: '受控浏览器点击', detail: '#publish', risk: 'dangerous', mutating: true },
        action,
        { success: false, error: 'denied' },
      ),
    ).resolves.toEqual({ success: false, error: 'denied' })
    expect(action).not.toHaveBeenCalled()
  })

  it('preserves risk metadata and invokes an approved action once', async () => {
    approval.mockResolvedValue(true)
    const action = vi.fn(async () => ({ success: true }))
    await expect(
      runWorkspaceBrokeredAction(
        { title: '写回外部工作区', detail: 'SAF', risk: 'dangerous', mutating: true },
        action,
        { success: false },
      ),
    ).resolves.toEqual({ success: true })
    expect(approval).toHaveBeenCalledWith(expect.objectContaining({ risk: 'dangerous', mutating: true }))
    expect(action).toHaveBeenCalledTimes(1)
  })
})
