const transferStages = ['queued', 'pending', 'downloading', 'running', 'waiting', 'retrying', 'paused']

export function runtimeReady(status) {
  if (status.available === false || status.installed === false) return false
  return status.ready === true || (status.ready == null && status.installed === true && status.state === 'ready')
}

function nativePhase(status, download) {
  if (status.available === false || status.state === 'unsupported') return 'unsupported'
  if (runtimeReady(status)) return 'ready'
  if (status.error || status.state === 'failed') return 'failed'
  var phase = status.state || (download.retainedPayload !== false && download.status) || 'not_downloaded'
  // The rootfs marker survives consumption of the download, independently of toolchain setup.
  if (status.installed && ['configuring', 'configuration_required'].indexOf(phase) < 0) return 'configuration_required'
  if (phase === 'ready' || (phase === 'completed' && download.retainedPayload === false)) return 'not_downloaded'
  if (transferStages.indexOf(phase) >= 0 && download.status === 'failed' && download.retainedPayload !== false) return 'failed'
  return phase
}

export function acceptedInstallPhase(status, accepted) {
  if (!accepted?.accepted || !['queued', 'downloading', 'installing', 'configuring'].includes(accepted.state)) return null
  var phase = nativePhase(status, status.download || {})
  // WorkManager may accept an operation before its row becomes visible to the first poll.
  var waitingForJob = phase === 'not_downloaded' ||
    (phase === 'completed' && accepted.state === 'installing') ||
    (phase === 'configuration_required' && accepted.state === 'configuring')
  return waitingForJob ? accepted.state : null
}

/**
 * @param {{state?: string, installed?: boolean, ready?: boolean, available?: boolean, error?: string,
 *   download?: {status?: string, bytesDownloaded?: number, bytesTotal?: number, retainedPayload?: boolean, error?: string}}} status
 * @param {{ok: boolean, output: string} | null} [verification]
 * @param {{accepted: boolean, state: string} | null} [accepted] Short-lived result from linux.install.
 */
export function statusView(status, verification = undefined, accepted = undefined) {
  var download = status.download || {}
  var phase = acceptedInstallPhase(status, accepted) || nativePhase(status, download)
  var error = status.error || (download.retainedPayload !== false && download.error)
  var labels = {
    not_downloaded: '未安装', queued: '等待下载', pending: '等待下载', downloading: '正在下载镜像',
    running: '正在下载镜像', waiting: '等待网络', retrying: '等待重试', paused: '下载已暂停',
    cancelled: '下载已取消', verifying: '正在校验镜像', completed: '镜像已下载，等待安装',
    installing: '正在安装根文件系统', extracting: '正在解压镜像', configuring: '正在配置开发工具',
    configuration_required: '开发工具等待配置', ready: '安装成功 · 环境可用', failed: '安装失败', unsupported: '当前架构不支持 Ubuntu'
  }
  var active = ['queued', 'pending', 'downloading', 'running', 'waiting', 'retrying', 'verifying', 'completed', 'installing', 'extracting', 'configuring'].indexOf(phase) >= 0
  var children = [
    { type: 'heading', key: 'title', content: 'Ubuntu 24.04', level: 2 },
    { type: 'text', key: 'intro', content: '完整开发环境，适合 apt/deb、glibc、Python、Node.js 和原生构建任务。', size: 'sm' },
    { type: 'badge', key: active ? 'ubuntu-install-active' : 'state', label: labels[phase] || '等待状态更新', tone: phase === 'ready' ? 'success' : phase === 'failed' ? 'error' : 'neutral' }
  ]
  var liveTransfer = !download.status || transferStages.indexOf(download.status) >= 0
  if (transferStages.indexOf(phase) >= 0 && liveTransfer && download.retainedPayload !== false && download.bytesTotal > 0 && !status.installed) {
    var percent = Math.max(0, Math.min(100, (download.bytesDownloaded || 0) * 100 / download.bytesTotal))
    children.push({
      type: 'progress', key: 'download', value: percent,
      label: '镜像下载 ' + percent.toFixed(1) + '% · ' + ((download.bytesDownloaded || 0) / 1048576).toFixed(1) + ' / ' + (download.bytesTotal / 1048576).toFixed(1) + ' MiB'
    })
  }
  if (phase === 'failed' && error) {
    children.push({ type: 'alert', key: 'error', tone: 'error', content: '失败原因：' + String(error).slice(0, 900) })
  }
  if (phase !== 'ready' && phase !== 'unsupported') {
    children.push({ type: 'text', key: 'notice', size: 'sm', content: status.installed ? 'Ubuntu 镜像已解压。配置 Python、Node.js 和编译工具需要联网，请保留至少 2 GB 可用空间。' : '镜像由下载管理器断点续传，离开页面后仍会继续。请保留至少 2 GB 可用空间。' })
    if (!active || phase === 'completed') {
      var label = phase === 'failed' ? '重试安装' : phase === 'paused' ? '继续下载' : phase === 'completed' || status.installed ? '继续安装' : '下载并安装'
      children.push({ type: 'button', key: 'install', label: label, icon: 'download', action: { type: 'invoke', handler: 'install' } })
    }
  }
  children.push({ type: 'button', key: 'refresh', label: '刷新状态', icon: 'refresh', variant: 'default', action: { type: 'invoke', handler: 'render' } })
  if (phase === 'ready') {
    children.push({ type: 'button', key: 'verify', label: '验证开发环境', action: { type: 'invoke', handler: 'verify_environment' } })
    if (verification) {
      children.push({ type: 'badge', key: 'verification-state', label: verification.ok ? '环境验证通过' : '环境验证失败', tone: verification.ok ? 'success' : 'error' })
      children.push({ type: 'codeBlock', key: 'verification-output', content: verification.output })
    }
  }
  if (status.installed) children.push({ type: 'button', key: 'remove', label: '删除 Ubuntu 环境', icon: 'trash', variant: 'danger', action: { type: 'invoke', handler: 'remove' } })
  return { schemaVersion: 1, title: 'Ubuntu 24.04', children: children }
}
