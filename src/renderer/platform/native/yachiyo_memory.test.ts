import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readNativeMemoryBlob, removeNativeMemoryBlob, writeNativeMemoryBlob } from './yachiyo_memory'

const native = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), remove: vi.fn(), clear: vi.fn() }))

vi.mock('@capacitor/core', () => ({ registerPlugin: vi.fn(() => native) }))

describe('YachiyoMemory bridge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the native contract scoped to encrypted blob values', async () => {
    native.read.mockResolvedValue({ found: true, value: 'yachiyo-secure-storage:...' })
    native.write.mockResolvedValue(undefined)
    native.remove.mockResolvedValue({ removed: true })
    await readNativeMemoryBlob('memory:index')
    await writeNativeMemoryBlob('memory:index', 'yachiyo-secure-storage:...')
    await removeNativeMemoryBlob('memory:index')
    expect(native.read).toHaveBeenCalledWith({ key: 'memory:index' })
    expect(native.write).toHaveBeenCalledWith({ key: 'memory:index', value: 'yachiyo-secure-storage:...' })
    expect(native.remove).toHaveBeenCalledWith({ key: 'memory:index' })
  })
})
