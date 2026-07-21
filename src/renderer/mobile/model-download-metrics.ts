import type { DownloadJob } from '@shared/models/model-catalog'

export interface DownloadSample {
  bytesDownloaded: number
  capturedAt: number
  bytesPerSecond: number
  lastProgressBytes: number
  lastProgressAt: number
}

export interface DownloadEstimate {
  sample: DownloadSample
  bytesPerSecond: number
  remainingSeconds?: number
}

export function updateDownloadEstimate(
  job: Pick<DownloadJob, 'status' | 'bytesDownloaded' | 'bytesTotal'>,
  previous: DownloadSample | undefined,
  capturedAt: number,
): DownloadEstimate {
  if (job.status !== 'downloading') {
    return {
      sample: {
        bytesDownloaded: job.bytesDownloaded,
        capturedAt,
        bytesPerSecond: 0,
        lastProgressBytes: job.bytesDownloaded,
        lastProgressAt: capturedAt,
      },
      bytesPerSecond: 0,
    }
  }

  let bytesPerSecond = previous?.bytesPerSecond || 0
  let lastProgressBytes = previous?.lastProgressBytes ?? previous?.bytesDownloaded ?? job.bytesDownloaded
  let lastProgressAt = previous?.lastProgressAt ?? previous?.capturedAt ?? capturedAt
  if (capturedAt > lastProgressAt && job.bytesDownloaded > lastProgressBytes) {
    const elapsedSeconds = (capturedAt - lastProgressAt) / 1000
    const instantSpeed = (job.bytesDownloaded - lastProgressBytes) / elapsedSeconds
    bytesPerSecond = bytesPerSecond > 0 ? bytesPerSecond * 0.65 + instantSpeed * 0.35 : instantSpeed
    lastProgressBytes = job.bytesDownloaded
    lastProgressAt = capturedAt
  } else if (capturedAt - lastProgressAt >= 5_000) {
    // Reset the baseline after a network stall so resumed traffic does not report a false spike.
    bytesPerSecond = 0
    lastProgressBytes = job.bytesDownloaded
    lastProgressAt = capturedAt
  }

  const remainingBytes = Math.max(0, job.bytesTotal - job.bytesDownloaded)
  return {
    sample: { bytesDownloaded: job.bytesDownloaded, capturedAt, bytesPerSecond, lastProgressBytes, lastProgressAt },
    bytesPerSecond,
    remainingSeconds: bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : undefined,
  }
}
