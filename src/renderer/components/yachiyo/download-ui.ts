const EXACT_DOWNLOAD_ERRORS: Record<string, string> = {
  download_failed: '下载失败，请检查网络连接后重试',
  model_download_failed: '模型下载失败，请检查网络连接和剩余存储空间',
  sandbox_download_failed: 'Linux 沙箱下载失败，请检查网络连接后重试',
  update_download_failed: '更新包下载失败，请稍后重试',
  download_paused: '下载已暂停',
  download_cancelled: '下载已取消',
  download_size_required: '下载源没有提供有效的文件大小',
  download_size_invalid: '下载文件大小无效或超出限制',
  update_size_invalid: '更新包大小无效或超出限制',
  download_size_mismatch: '下载文件大小与服务器声明不一致',
  download_integrity_failed: '文件完整性校验失败，请重新下载',
  download_storage_unavailable: '无法写入应用存储，请检查剩余空间',
  download_segment_storage_unavailable: '无法创建分段下载缓存，请检查剩余空间',
  download_segment_reset_failed: '无法重置损坏的下载分段',
  sandbox_download_storage_unavailable: '无法写入 Linux 沙箱安装包，请检查剩余空间',
  update_storage_unavailable: '无法写入更新包，请检查剩余空间',
  download_range_unsupported: '下载服务器不支持断点续传，已无法继续当前任务',
  download_range_mismatch: '下载服务器返回了错误的分段范围，请更换下载源或代理',
  feature_disabled: '对应功能已关闭，请先在功能管理中启用后重试',
  download_action_not_accepted: '下载器未接受该操作，请刷新状态后重试',
  download_task_not_found: '下载记录不存在或已被移除',
  download_redirect_invalid: '下载地址返回了无效的跳转',
  sandbox_redirect_invalid: 'Linux 沙箱下载地址返回了无效的跳转',
  update_redirect_invalid: '更新地址返回了无效的跳转',
  model_redirect_invalid: '模型下载地址返回了无效的跳转',
  download_redirect_limit: '下载地址跳转次数过多',
  sandbox_redirect_limit: 'Linux 沙箱下载地址跳转次数过多',
  update_redirect_limit: '更新地址跳转次数过多',
  model_redirect_limit: '模型下载地址跳转次数过多',
  download_host_unresolved: '无法解析下载服务器地址',
  download_host_private: '为保护设备安全，下载器拒绝访问局域网地址',
  download_url_rejected: '下载地址无效或不符合安全要求',
  download_url_port_rejected: '下载地址使用了不受支持的端口',
  sandbox_download_url_rejected: 'Linux 沙箱下载地址无效或不符合安全要求',
  update_sidecar_too_large: '更新校验文件大小异常',
  update_sidecar_invalid: '更新校验文件无效',
}

export function humanizeDownloadError(error: string | undefined): string {
  const code = error?.trim()
  if (!code) return ''
  const exact = EXACT_DOWNLOAD_ERRORS[code]
  if (exact) return exact
  const httpMatch = code.match(/(?:download|model|sandbox|update)_http_(\d{3})$/)
  if (httpMatch) return `下载服务器返回错误（HTTP ${httpMatch[1]}）`
  if (/timeout|timed_out/i.test(code)) return '下载连接超时，请检查网络或代理设置'
  if (/unknownhost|unresolved|dns/i.test(code)) return '无法解析下载服务器地址，请检查网络或代理设置'
  if (/connection|network|socket/i.test(code)) return '网络连接中断，请稍后继续下载'
  if (/space|storage|enospc/i.test(code)) return '设备存储空间不足或无法写入'
  return `下载失败（${code.slice(0, 80)}）`
}

/** Feature-gated Capacitor proxies resolve a sentinel instead of rejecting; never treat it as success. */
export function requireAcceptedDownloadAction(result: unknown): void {
  if (!result || typeof result !== 'object') return
  const value = result as Record<string, unknown>
  if (value.available === false) throw new Error(typeof value.reason === 'string' ? value.reason : 'feature_disabled')
  if (value.accepted === false || value.success === false) {
    throw new Error(typeof value.reason === 'string' ? value.reason : 'download_action_not_accepted')
  }
}

export function downloadProgress(downloaded: number, total: number): number {
  if (!Number.isFinite(downloaded) || !Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(100, (downloaded / total) * 100))
}
