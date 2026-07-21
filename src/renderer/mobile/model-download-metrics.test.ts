import { describe, expect, it } from 'vitest'
import { updateDownloadEstimate } from './model-download-metrics'

describe('updateDownloadEstimate', () => {
  it('calculates speed and remaining time from persisted progress', () => {
    const estimate = updateDownloadEstimate(
      { status: 'downloading', bytesDownloaded: 30_000_000, bytesTotal: 100_000_000 },
      {
        bytesDownloaded: 10_000_000,
        capturedAt: 1_000,
        bytesPerSecond: 0,
        lastProgressBytes: 10_000_000,
        lastProgressAt: 1_000,
      },
      3_000,
    )

    expect(estimate.bytesPerSecond).toBe(10_000_000)
    expect(estimate.remainingSeconds).toBe(7)
  })

  it('keeps the last speed when a poll sees no new persisted bytes', () => {
    const estimate = updateDownloadEstimate(
      { status: 'downloading', bytesDownloaded: 30_000_000, bytesTotal: 100_000_000 },
      {
        bytesDownloaded: 30_000_000,
        capturedAt: 3_000,
        bytesPerSecond: 5_000_000,
        lastProgressBytes: 30_000_000,
        lastProgressAt: 3_000,
      },
      4_000,
    )

    expect(estimate.bytesPerSecond).toBe(5_000_000)
    expect(estimate.remainingSeconds).toBe(14)
  })

  it('clears stale speed after a download stops', () => {
    const estimate = updateDownloadEstimate(
      { status: 'paused', bytesDownloaded: 30_000_000, bytesTotal: 100_000_000 },
      {
        bytesDownloaded: 20_000_000,
        capturedAt: 1_000,
        bytesPerSecond: 5_000_000,
        lastProgressBytes: 20_000_000,
        lastProgressAt: 1_000,
      },
      2_000,
    )

    expect(estimate.bytesPerSecond).toBe(0)
    expect(estimate.remainingSeconds).toBeUndefined()
  })

  it('drops stale speed and resets its baseline after a download stalls', () => {
    const stalled = updateDownloadEstimate(
      { status: 'downloading', bytesDownloaded: 30_000_000, bytesTotal: 100_000_000 },
      {
        bytesDownloaded: 30_000_000,
        capturedAt: 3_000,
        bytesPerSecond: 5_000_000,
        lastProgressBytes: 30_000_000,
        lastProgressAt: 3_000,
      },
      8_000,
    )

    expect(stalled.bytesPerSecond).toBe(0)
    expect(stalled.remainingSeconds).toBeUndefined()

    const resumed = updateDownloadEstimate(
      { status: 'downloading', bytesDownloaded: 33_000_000, bytesTotal: 100_000_000 },
      stalled.sample,
      9_500,
    )
    expect(resumed.bytesPerSecond).toBe(2_000_000)
    expect(resumed.remainingSeconds).toBe(33.5)
  })
})
