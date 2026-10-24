import { describe, expect, it, vi } from 'vitest'
import { loadVersionStatus } from './useVersion'

describe('loadVersionStatus', () => {
  it('exposes local version even when the update server fails', async () => {
    const onLocalVersion = vi.fn()
    await expect(
      loadVersionStatus(
        true,
        async () => '0.0.24',
        async () => {
          throw new Error('offline')
        },
        onLocalVersion
      )
    ).rejects.toThrow('offline')
    expect(onLocalVersion).toHaveBeenCalledWith('0.0.24')
  })
  it('loads only the local version when remote update checks are disabled', async () => {
    const getVersion = vi.fn(async () => '1.0.0')
    const checkNeedUpdate = vi.fn(async () => true)

    await expect(loadVersionStatus(false, getVersion, checkNeedUpdate)).resolves.toEqual({
      needCheckUpdate: false,
      version: '1.0.0',
    })
    expect(getVersion).toHaveBeenCalledOnce()
    expect(checkNeedUpdate).not.toHaveBeenCalled()
  })

  it('uses the supplied release checker when update checks are enabled', async () => {
    const getVersion = vi.fn(async () => '0.0.2')
    const checkNeedUpdate = vi.fn(async () => true)

    await expect(loadVersionStatus(true, getVersion, checkNeedUpdate)).resolves.toEqual({
      needCheckUpdate: true,
      version: '0.0.2',
    })
    expect(checkNeedUpdate).toHaveBeenCalledWith('0.0.2')
  })
})
