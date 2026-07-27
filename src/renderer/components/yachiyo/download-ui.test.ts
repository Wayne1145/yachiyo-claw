import { describe, expect, it } from 'vitest'
import { downloadProgress, humanizeDownloadError, requireAcceptedDownloadAction } from './download-ui'

describe('humanizeDownloadError', () => {
  it('translates common native download errors', () => {
    expect(humanizeDownloadError('model_download_failed')).toBe('模型下载失败，请检查网络连接和剩余存储空间')
    expect(humanizeDownloadError('download_integrity_failed')).toBe('文件完整性校验失败，请重新下载')
    expect(humanizeDownloadError('download_http_403')).toBe('下载服务器返回错误（HTTP 403）')
  })

  it('keeps a bounded diagnostic code for unknown errors', () => {
    expect(humanizeDownloadError('vendor_specific_failure')).toBe('下载失败（vendor_specific_failure）')
    expect(humanizeDownloadError(undefined)).toBe('')
  })
})

describe('requireAcceptedDownloadAction', () => {
  it('rejects feature-gate and native refusal sentinels', () => {
    expect(() => requireAcceptedDownloadAction({ available: false, reason: 'feature_disabled' })).toThrow(
      'feature_disabled',
    )
    expect(() => requireAcceptedDownloadAction({ accepted: false })).toThrow('download_action_not_accepted')
    expect(() => requireAcceptedDownloadAction({ success: false, reason: 'sandbox_failed' })).toThrow('sandbox_failed')
  })

  it('accepts successful and void bridge results', () => {
    expect(() => requireAcceptedDownloadAction({ accepted: true })).not.toThrow()
    expect(() => requireAcceptedDownloadAction(undefined)).not.toThrow()
  })
})

describe('downloadProgress', () => {
  it('clamps invalid and out-of-range native progress', () => {
    expect(downloadProgress(150, 100)).toBe(100)
    expect(downloadProgress(-10, 100)).toBe(0)
    expect(downloadProgress(10, 0)).toBe(0)
  })
})
