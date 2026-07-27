import { spawn } from 'node:child_process'
import { access, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'

const runtimePath: string = '../src/renderer/plugins/blob-worker-runtime.ts'
const runtimeNamespace = await import(runtimePath)
const runtimeModuleWithOptionalDefault = runtimeNamespace as typeof import('../src/renderer/plugins/blob-worker-runtime') & {
  default?: typeof import('../src/renderer/plugins/blob-worker-runtime')
}
const runtimeModule = runtimeModuleWithOptionalDefault.default ?? runtimeModuleWithOptionalDefault
const { buildOpaquePluginFrameDocument } = runtimeModule
const protocolNamespace = await import('../src/renderer/plugins/rpc-protocol')
const protocolModuleWithOptionalDefault = protocolNamespace as typeof import('../src/renderer/plugins/rpc-protocol') & {
  default?: typeof import('../src/renderer/plugins/rpc-protocol')
}
const { PLUGIN_RPC_PROTOCOL_VERSION } = protocolModuleWithOptionalDefault.default ?? protocolModuleWithOptionalDefault

const candidates = [
  process.env.YACHIYO_CHROMIUM,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter((value): value is string => Boolean(value))
let browser = ''
for (const candidate of candidates) {
  try {
    await access(candidate)
    browser = candidate
    break
  } catch {
    // Try the next configured/system Chromium executable.
  }
}
if (!browser) throw new Error('chromium_browser_not_found')

const channelId = 'plugin-isolation-probe'
const frameDocument = buildOpaquePluginFrameDocument(channelId)
let baseUrl = ''
let leakRequests = 0

function pluginEntry(): string {
  return `yachiyo.registerTool('probe', async function () {
    function inherited(name) {
      var target = self;
      while (target) {
        var descriptor = Object.getOwnPropertyDescriptor(target, name);
        if (descriptor) {
          try { return descriptor.get ? descriptor.get.call(self) : descriptor.value; }
          catch (error) { return error && error.name; }
        }
        target = Object.getPrototypeOf(target);
      }
    }
    var result = { origin: self.origin || 'null' };
    try { result.escapedOrigin = Function('return this')().origin || 'null'; }
    catch (error) { result.escapedOrigin = error && error.name ? error.name : 'unavailable'; }
    try {
      var database = inherited('indexedDB');
      if (!database || typeof database.open !== 'function') throw new Error('unavailable');
      database.open('host-data'); result.indexedDB = 'opened';
    } catch (error) { result.indexedDB = error && error.name ? error.name : 'unavailable'; }
    try {
      if (!self.navigator || !self.navigator.storage || typeof self.navigator.storage.getDirectory !== 'function') throw new Error('unavailable');
      await self.navigator.storage.getDirectory(); result.opfs = 'opened';
    } catch (error) { result.opfs = error && error.name ? error.name : 'unavailable'; }
    try {
      var cacheStorage = inherited('caches');
      if (!cacheStorage || typeof cacheStorage.open !== 'function') throw new Error('unavailable');
      await cacheStorage.open('host-cache'); result.caches = 'opened';
    } catch (error) { result.caches = error && error.name ? error.name : 'unavailable'; }
    try {
      var Face = inherited('FontFace');
      var face = new Face('probe', 'url(${baseUrl}/leak.woff)');
      var fontSet = inherited('fonts');
      if (fontSet && typeof fontSet.add === 'function') fontSet.add(face);
      await face.load(); result.font = 'loaded';
    } catch (error) { result.font = error && error.name ? error.name : 'unavailable'; }
    try { await self.fetch('${baseUrl}/leak-fetch'); result.fetchAttempt = 'loaded'; }
    catch (error) { result.fetchAttempt = error && error.name ? error.name : 'unavailable'; }
    try { var request = new self.XMLHttpRequest(); request.open('GET', '${baseUrl}/leak-xhr'); result.xhrAttempt = 'opened'; }
    catch (error) { result.xhrAttempt = error && error.name ? error.name : 'unavailable'; }
    try { new self.WebSocket('ws://127.0.0.1:9'); result.webSocketAttempt = 'opened'; }
    catch (error) { result.webSocketAttempt = error && error.name ? error.name : 'unavailable'; }
    try { self.importScripts('${baseUrl}/leak-script.js'); result.importAttempt = 'loaded'; }
    catch (error) { result.importAttempt = error && error.name ? error.name : 'unavailable'; }
    try { new self.Worker(URL.createObjectURL(new Blob(['postMessage(1)']))); result.nestedWorker = 'opened'; }
    catch (error) { result.nestedWorker = error && error.name ? error.name : 'unavailable'; }
    result.localStorage = typeof self.localStorage;
    result.capacitor = typeof self.Capacitor;
    result.rawPostMessage = typeof self.postMessage;
    result.rawMessageListener = typeof self.addEventListener;
    return result;
  });`
}

function outerDocument(): string {
  const frame = JSON.stringify(frameDocument).replace(/</g, '\\u003c')
  const entry = JSON.stringify(pluginEntry()).replace(/</g, '\\u003c')
  return `<!doctype html><meta charset="utf-8"><pre id="result">pending</pre><script>
    var channelId = ${JSON.stringify(channelId)};
    var frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = ${frame};
    addEventListener('message', function (event) {
      if (event.source !== frame.contentWindow || !event.data || event.data.channelId !== channelId) return;
      if (event.data.type === 'bridge-ready') {
        frame.contentWindow.postMessage({ channelId: channelId, type: 'host-message', payload: {
          type: 'load', protocolVersion: ${PLUGIN_RPC_PROTOCOL_VERSION}, pluginId: 'probe', entry: ${entry}
        } }, '*');
      } else if (event.data.type === 'worker-message' && event.data.payload.type === 'ready') {
        frame.contentWindow.postMessage({ channelId: channelId, type: 'host-message', payload: {
          type: 'invoke', callId: 'probe-call', name: 'probe', args: {}
        } }, '*');
      } else if (event.data.type === 'worker-message' && event.data.payload.type === 'result') {
        document.getElementById('result').textContent = JSON.stringify(event.data.payload.value);
      } else if (event.data.type === 'bridge-error' || (event.data.payload && (event.data.payload.type === 'error' || event.data.payload.type === 'load-error'))) {
        document.getElementById('result').textContent = JSON.stringify({ error: event.data.payload || event.data.type });
      }
    });
    document.body.appendChild(frame);
  <\/script>`
}

const server = createServer((request, response) => {
  if (request.url === '/leak.woff') {
    leakRequests++
    response.writeHead(200, { 'content-type': 'font/woff2' })
    response.end('not-a-real-font')
    return
  }
  if (request.url?.startsWith('/leak-')) leakRequests++
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(outerDocument())
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('plugin_isolation_server_failed')
baseUrl = `http://127.0.0.1:${address.port}`

const debugPort = await new Promise<number>((resolve, reject) => {
  const probe = createNetServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => {
    const selected = probe.address()
    if (!selected || typeof selected === 'string') {
      probe.close()
      reject(new Error('plugin_isolation_debug_port_failed'))
      return
    }
    probe.close(() => resolve(selected.port))
  })
})

const profile = join(process.cwd(), '.cache', 'plugin-isolation-chromium')
await rm(profile, { recursive: true, force: true })
await mkdir(profile, { recursive: true })
const browserProcess = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--disable-background-networking',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
let browserErrors = ''
browserProcess.stderr?.on('data', (chunk) => {
  if (browserErrors.length < 16 * 1024) browserErrors += String(chunk)
})

async function debuggerTarget(): Promise<string> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as Array<{
        type?: string
        url?: string
        webSocketDebuggerUrl?: string
      }>
      const target = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl
    } catch {
      // Chromium has not opened its debugging endpoint yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`plugin_isolation_debugger_unavailable:${browserErrors.slice(0, 500)}`)
}

async function connectCdp(url: string) {
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('plugin_isolation_cdp_failed')), { once: true })
  })
  let sequence = 0
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const events: unknown[] = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number
      method?: string
      params?: unknown
      result?: unknown
      error?: { message?: string }
    }
    if (!message.id) {
      if (message.method && events.length < 50) events.push({ method: message.method, params: message.params })
      return
    }
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message || 'plugin_isolation_cdp_command_failed'))
    else waiter.resolve(message.result)
  })
  return {
    send(method: string, params: Record<string, unknown> = {}) {
      const id = ++sequence
      const response = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }))
      socket.send(JSON.stringify({ id, method, params }))
      return response
    },
    events,
    close: () => socket.close(),
  }
}

try {
  const cdp = await connectCdp(await debuggerTarget())
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: baseUrl })
  let value = 'pending'
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && value === 'pending') {
    const response = (await cdp.send('Runtime.evaluate', {
      expression: "document.querySelector('#result')?.textContent || 'missing'",
      returnByValue: true,
    })) as { result?: { value?: string } }
    value = response.result?.value ?? 'missing'
    if (value === 'pending') await new Promise((resolve) => setTimeout(resolve, 100))
  }
  cdp.close()
  if (value === 'pending' || value === 'missing') {
    throw new Error(
      `plugin_isolation_probe_did_not_finish:${JSON.stringify(cdp.events).slice(0, 4_000)}:${browserErrors.slice(0, 1_000)}`,
    )
  }
  const result = JSON.parse(value) as Record<string, string>
  if (result.error) throw new Error(`plugin_isolation_probe_failed:${JSON.stringify(result)}`)
  if (result.origin !== 'null' || result.escapedOrigin !== 'null') {
    throw new Error(`plugin_worker_origin_not_opaque:${result.origin}:${result.escapedOrigin}`)
  }
  for (const capability of ['indexedDB', 'opfs', 'caches']) {
    if (result[capability] === 'opened') throw new Error(`plugin_storage_escape:${capability}`)
  }
  if (result.font === 'loaded' || leakRequests !== 0) throw new Error('plugin_font_network_escape')
  for (const capability of ['fetchAttempt', 'xhrAttempt', 'webSocketAttempt', 'importAttempt', 'nestedWorker']) {
    if (result[capability] === 'loaded' || result[capability] === 'opened') {
      throw new Error(`plugin_ambient_escape:${capability}`)
    }
  }
  if (
    result.localStorage !== 'undefined' ||
    result.capacitor !== 'undefined' ||
    result.rawPostMessage !== 'undefined' ||
    result.rawMessageListener !== 'undefined'
  ) {
    throw new Error('plugin_host_global_escape')
  }
  process.stdout.write(`${JSON.stringify({ ...result, leakRequests }, null, 2)}\n`)
} finally {
  browserProcess.kill()
  server.close()
  await new Promise<void>((resolve) => {
    if (browserProcess.exitCode !== null) resolve()
    else {
      browserProcess.once('exit', () => resolve())
      setTimeout(resolve, 2_000)
    }
  })
  await rm(profile, { recursive: true, force: true })
}
