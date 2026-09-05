function statusView(status) {
  var state = status.ready ? '可用' : status.installed ? '正在配置' : status.state === 'downloading' ? '正在下载' : '未安装'
  var children = [
    { type: 'heading', key: 'title', content: 'Ubuntu 24.04', level: 2 },
    { type: 'text', key: 'intro', content: '完整开发环境，适合 apt/deb、glibc、Python、Node.js 和原生构建任务。', size: 'sm' },
    { type: 'badge', key: 'state', label: state, tone: status.ready ? 'success' : status.state === 'failed' ? 'error' : 'neutral' }
  ]
  if (status.download && status.download.bytesTotal > 0) {
    children.push({
      type: 'progress',
      key: 'download',
      value: Math.max(0, Math.min(100, status.download.bytesDownloaded * 100 / status.download.bytesTotal)),
      label: 'Ubuntu Base 下载进度'
    })
  }
  if (!status.ready) {
    children.push({
      type: 'alert', key: 'notice', tone: 'info',
      content: status.state === 'completed' ? '镜像下载完成，点击继续安装并配置开发工具。' : '安装使用统一下载器，退出页面后仍会继续。建议保留至少 2 GB 可用空间。'
    })
    children.push({ type: 'button', key: 'install', label: status.state === 'completed' || status.installed ? '继续安装' : '下载并安装', icon: 'download', action: { type: 'invoke', handler: 'install' } })
  }
  children.push({ type: 'button', key: 'refresh', label: '刷新状态', icon: 'refresh', variant: 'default', action: { type: 'invoke', handler: 'render' } })
  if (status.installed) children.push({ type: 'button', key: 'remove', label: '删除 Ubuntu 环境', icon: 'trash', variant: 'danger', action: { type: 'invoke', handler: 'remove' } })
  return { schemaVersion: 1, title: 'Ubuntu 24.04', children: children }
}

yachiyo.registerTool('render', async function () {
  return statusView(await yachiyo.host.call('linux.status', {}))
})
yachiyo.registerTool('install', async function () {
  await yachiyo.host.call('linux.install', {})
  return statusView(await yachiyo.host.call('linux.status', {}))
})
yachiyo.registerTool('remove', async function () {
  await yachiyo.host.call('linux.remove', {})
  return statusView(await yachiyo.host.call('linux.status', {}))
})

yachiyo.registerTool('ubuntu-runtime_status', function () { return yachiyo.host.call('linux.status', {}) })
yachiyo.registerTool('ubuntu-runtime_exec', function (args) { return yachiyo.host.call('linux.exec', args) })
yachiyo.registerTool('ubuntu-runtime_start_job', function (args) { return yachiyo.host.call('linux.startJob', args) })
yachiyo.registerTool('ubuntu-runtime_job_status', function (args) { return yachiyo.host.call('linux.jobStatus', args) })
yachiyo.registerTool('ubuntu-runtime_job_output', function (args) { return yachiyo.host.call('linux.jobOutput', args) })
yachiyo.registerTool('ubuntu-runtime_stop_job', function (args) { return yachiyo.host.call('linux.stopJob', args) })
yachiyo.registerTool('ubuntu-runtime_read_file', function (args) { return yachiyo.host.call('linux.readFile', args) })
yachiyo.registerTool('ubuntu-runtime_write_file', function (args) { return yachiyo.host.call('linux.writeFile', args) })
