import { describe, expect, it, vi } from 'vitest'
import { loadVersionStatus } from './useVersion'

describe('loadVersionStatus', () => {
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
})
