import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForCameraFrame } from './camera-frame'

afterEach(() => vi.useRealTimers())
describe('camera readiness', () => {
  it('waits for the first video frame instead of failing the tool immediately', async () => {
    vi.useFakeTimers()
    const video = {
      isConnected: true,
      srcObject: { getVideoTracks: () => [{ readyState: 'live' }] },
      readyState: 0,
      videoWidth: 0,
      videoHeight: 0,
    }
    const waiting = waitForCameraFrame(video as unknown as HTMLVideoElement)
    video.readyState = 2
    video.videoWidth = 1280
    video.videoHeight = 720
    await vi.advanceTimersByTimeAsync(60)
    await expect(waiting).resolves.toBeUndefined()
  })
  it('refuses frames from a revoked camera stream', async () => {
    const video = {
      isConnected: true,
      srcObject: { getVideoTracks: () => [{ readyState: 'ended' }] },
      readyState: 2,
      videoWidth: 1280,
      videoHeight: 720,
    }
    await expect(waitForCameraFrame(video as unknown as HTMLVideoElement)).rejects.toThrow('camera_disabled')
  })
})
