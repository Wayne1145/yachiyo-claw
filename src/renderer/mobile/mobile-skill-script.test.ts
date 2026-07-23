import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  approve: vi.fn(async () => true),
  executeAction: vi.fn(async (options: { execute: () => Promise<unknown> }) => options.execute()),
  write: vi.fn(async () => ({ success: true })),
  exec: vi.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 })),
  kill: vi.fn(async () => ({ killed: true })),
}))

vi.mock('./agent-approval', () => ({ requestAgentApproval: state.approve }))
vi.mock('./agent-broker', () => ({ executeAgentAction: state.executeAction }))
vi.mock('@/platform/native/yachiyo_sandbox', () => ({
  yachiyoSandboxNative: {
    write: state.write,
    exec: state.exec,
    kill: state.kill,
  },
}))

import { executeMobileSkillScript } from './mobile-skill-script'

async function sha256(value: Uint8Array): Promise<string> {
  const owned = new Uint8Array(value.byteLength)
  owned.set(value)
  const digest = await crypto.subtle.digest('SHA-256', owned.buffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('mobile Skill sandbox execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stages and executes a verified script in the app-private Linux sandbox', async () => {
    const source = new TextEncoder().encode('print("hello")\n')
    const hash = await sha256(source)

    await expect(
      executeMobileSkillScript({
        skillName: 'hello-skill',
        script: {
          entrypoint: {
            name: 'run',
            path: 'scripts/run.py',
            runtime: 'python',
            sha256: hash,
            size: source.byteLength,
            timeoutMs: 5_000,
            workingDirectory: 'skill-private',
            isolation: 'none',
            capabilities: ['unrestricted-privileged'],
          },
          scriptBase64: btoa(String.fromCharCode(...source)),
        },
        args: ["Wayne's project"],
        grantedCapabilities: ['unrestricted-privileged'],
        signatureVerified: true,
        sessionId: 'task-1',
        toolCallId: 'tool-1',
      }),
    ).resolves.toMatchObject({ success: true, stdout: 'ok', exitCode: 0 })

    expect(state.write).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: expect.stringMatching(/^\.yachiyo\/skills\/hello-skill\/[a-f0-9]{16}\/scripts\/run\.py$/),
        content: 'print("hello")\n',
      }),
    )
    expect(state.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.stringContaining("python3 'run.py' 'Wayne'\\''s project'"),
        timeout: 5_000,
      }),
    )
    expect(state.executeAction).toHaveBeenCalledWith(expect.objectContaining({ backend: 'sandbox' }))
  })

  it('never stages a script whose declared hash does not match', async () => {
    const source = new TextEncoder().encode('echo unsafe\n')
    await expect(
      executeMobileSkillScript({
        skillName: 'bad-skill',
        script: {
          entrypoint: {
            name: 'run',
            path: 'run.sh',
            runtime: 'shell',
            sha256: '0'.repeat(64),
            size: source.byteLength,
            timeoutMs: 5_000,
            workingDirectory: 'workspace',
            isolation: 'none',
            capabilities: ['unrestricted-privileged'],
          },
          scriptBase64: btoa(String.fromCharCode(...source)),
        },
        grantedCapabilities: ['unrestricted-privileged'],
        signatureVerified: false,
      }),
    ).rejects.toThrow('skill_script_hash_mismatch')

    expect(state.write).not.toHaveBeenCalled()
    expect(state.exec).not.toHaveBeenCalled()
  })
})
