import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/platform', () => ({
  default: { type: 'mobile' },
}))

import { applyNativeUpdateDownloadStatus, useUpdateStore } from './updateStore'

describe('Android update download recovery', () => {
  beforeEach(() => {
    useUpdateStore.setState({
      status: 'idle',
      progress: 0,
      version: null,
      notes: '',
      releaseUrl: null,
      error: null,
      dismissedVersion: null,
    })
  })

  it('restores an in-flight task and keeps polling', () => {
    expect(
      applyNativeUpdateDownloadStatus({
        ready: false,
        version: '0.0.11',
        status: 'downloading',
        progress: 43,
      }),
    ).toBe(true)
    expect(useUpdateStore.getState()).toMatchObject({ status: 'downloading', version: '0.0.11', progress: 43 })
  })

  it('re-surfaces a verified package even after the old dialog was dismissed', () => {
    useUpdateStore.setState({ dismissedVersion: '0.0.11' })
    expect(
      applyNativeUpdateDownloadStatus({ ready: true, version: '0.0.11', status: 'completed', progress: 100 }),
    ).toBe(false)
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'downloaded',
      version: '0.0.11',
      progress: 100,
      dismissedVersion: null,
    })
  })

  it('turns a persisted failure into a visible error state', () => {
    applyNativeUpdateDownloadStatus({
      ready: false,
      version: '0.0.11',
      status: 'failed',
      progress: 12,
      error: 'update_digest_mismatch',
    })
    expect(useUpdateStore.getState()).toMatchObject({
      status: 'error',
      progress: 12,
      error: '更新包完整性校验失败，请重新下载。',
    })
  })

  it('clears a stale install prompt when native state is idle', () => {
    useUpdateStore.setState({ status: 'downloaded', version: '0.0.11', progress: 100 })
    applyNativeUpdateDownloadStatus({ ready: false, version: '', status: 'idle', progress: 0 })
    expect(useUpdateStore.getState()).toMatchObject({ status: 'idle', version: null, progress: 0, error: null })
  })
})
