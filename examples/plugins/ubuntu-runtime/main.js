import { statusView, runtimeReady, acceptedInstallPhase } from './status-view.mjs'

var acceptedInstall = null

async function readInstallation() {
  var status = await yachiyo.host.call('linux.status', {})
  if (acceptedInstall && (Date.now() >= acceptedInstall.until || !acceptedInstallPhase(status, acceptedInstall.receipt))) {
    acceptedInstall = null
  }
  return statusView(status, undefined, acceptedInstall && acceptedInstall.receipt)
}

yachiyo.registerTool('render', readInstallation)
yachiyo.registerTool('install', async function () {
  var request = await yachiyo.host.call('linux.install', {})
  if (request && request.accepted) acceptedInstall = { receipt: request, until: Date.now() + 15000 }
  return readInstallation()
})
yachiyo.registerTool('remove', async function () {
  await yachiyo.host.call('linux.remove', {})
  acceptedInstall = null
  return statusView(await yachiyo.host.call('linux.status', {}))
})

yachiyo.registerTool('verify_environment', async function () {
  var status = await yachiyo.host.call('linux.status', {})
  if (!runtimeReady(status)) return statusView(status)
  // The host displays this exact, fixed command for approval. No page input enters the shell.
  var result = await yachiyo.host.call('linux.exec', {
    command: 'set -eu; . /etc/os-release; printf "%s\\n" "$PRETTY_NAME"; python3 --version; printf "Node.js "; node --version; git --version',
    timeoutMs: 45000
  })
  var output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim().slice(0, 2000)
  return statusView(status, { ok: result.exitCode === 0 && !!output, output: output || '命令未返回版本信息。' })
})

yachiyo.registerTool('ubuntu-runtime_status', function () { return yachiyo.host.call('linux.status', {}) })
yachiyo.registerTool('ubuntu-runtime_exec', function (args) { return yachiyo.host.call('linux.exec', args) })
yachiyo.registerTool('ubuntu-runtime_start_job', function (args) { return yachiyo.host.call('linux.startJob', args) })
yachiyo.registerTool('ubuntu-runtime_job_status', function (args) { return yachiyo.host.call('linux.jobStatus', args) })
yachiyo.registerTool('ubuntu-runtime_job_output', function (args) { return yachiyo.host.call('linux.jobOutput', args) })
yachiyo.registerTool('ubuntu-runtime_stop_job', function (args) { return yachiyo.host.call('linux.stopJob', args) })
yachiyo.registerTool('ubuntu-runtime_read_file', function (args) { return yachiyo.host.call('linux.readFile', args) })
yachiyo.registerTool('ubuntu-runtime_write_file', function (args) { return yachiyo.host.call('linux.writeFile', args) })
