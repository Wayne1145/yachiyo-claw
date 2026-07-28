import { describe, expect, it } from 'vitest'
import { errorCodeFromMessage, formatErrorWithCode, getErrorHelp } from './error-help'

describe('error help', () => {
  it('indexes the private-host download error for the plugin and host message', () => {
    const entry = getErrorHelp('download_host_private')
    expect(entry?.title).toBe('下载器拒绝访问局域网地址')
    expect(entry?.resolutions).toContain('不要通过关闭安全校验来解决此问题。')
  })

  it('extracts native error codes and renders them with user-facing text', () => {
    expect(errorCodeFromMessage('download_host_private: 10.0.0.1')).toBe('download_host_private')
    expect(formatErrorWithCode('下载失败', 'download_host_private')).toBe('下载失败（错误代码：download_host_private）')
  })
})
