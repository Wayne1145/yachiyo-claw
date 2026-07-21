import { beforeEach, describe, expect, it, vi } from 'vitest'
import { yachiyoSandboxNative } from './yachiyo_sandbox'

const native = vi.hoisted(() => ({
  exec: vi.fn(),
  read: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ registerPlugin: vi.fn(() => native) }))

describe('YachiyoSandbox native bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps commands and workspace files on the native sandbox plugin', async () => {
    native.exec.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 })
    native.read.mockResolvedValue({ success: true, content: 'hello' })

    await expect(yachiyoSandboxNative.exec({ command: 'node --version', timeout: 5_000 })).resolves.toEqual({
      stdout: 'ok',
      stderr: '',
      exitCode: 0,
    })
    await expect(yachiyoSandboxNative.read({ filePath: 'src/index.ts' })).resolves.toEqual({
      success: true,
      content: 'hello',
    })
  })
})
