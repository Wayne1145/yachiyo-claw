import { type PluginRuntimeOptions, PluginRuntime } from './plugin-runtime'
import { PLUGIN_RPC_PROTOCOL_VERSION, type Transport } from './rpc-protocol'

/**
 * Opaque-origin Blob-Worker transport for the plugin runtime (platform-21).
 *
 * A main-frame Blob Worker inherits `https://localhost` and can open the app's IndexedDB even when its
 * global reference is overwritten (the WebIDL property is inherited). Instead, a sandboxed srcdoc
 * iframe without `allow-same-origin` creates the Worker. The Worker therefore gets an opaque origin;
 * its inherited CSP also blocks every ambient network/subresource channel. The iframe only forwards
 * typed RPC messages and never evaluates plugin code itself, so even a legacy WebView frame bridge is
 * not reachable from the Worker.
 *
 * The protocol implemented inline below mirrors `plugin-sandbox.ts` (which the unit tests exercise);
 * a Blob Worker must be self-contained, so it cannot import the bundled TS module. Requires the
 * frame CSP's `'unsafe-eval'` for `new Function`.
 */
export const WORKER_BOOTSTRAP_SOURCE = `(function () {
  var protocolVersion = ${PLUGIN_RPC_PROTOCOL_VERSION};
  var hostPostMessage = self.postMessage.bind(self); var hostAddEventListener = self.addEventListener.bind(self); var objectKeys = Object.keys; var HostPromise = Promise;
  var blockedAmbient = ['fetch','fetchLater','XMLHttpRequest','WebSocket','WebSocketStream','EventSource','WebTransport','indexedDB','importScripts','Worker','SharedWorker','BroadcastChannel','caches','openDatabase','cookieStore','FontFace','fonts','navigator','postMessage','addEventListener','removeEventListener','dispatchEvent','onmessage','onmessageerror','MessageEvent'];
  function removeAmbient(name) {
    var cursor = self;
    while (cursor) {
      var descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(cursor, name); } catch (error) { return false; }
      if (descriptor) {
        if (!descriptor.configurable) return false;
        try { if (!delete cursor[name]) return false; } catch (error) { return false; }
      }
      cursor = Object.getPrototypeOf(cursor);
    }
    try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); }
    catch (error) { return false; }
    return self[name] === undefined;
  }
  for (var ambientIndex = 0; ambientIndex < blockedAmbient.length; ambientIndex++) {
    if (!removeAmbient(blockedAmbient[ambientIndex])) { hostPostMessage({ type: 'load-error', error: 'worker_isolation_unavailable' }); self.close(); return; }
  }
  var tools = Object.create(null); var pendingHost = Object.create(null); var hostSeq = 0; var toolCount = 0; var currentInvocationId = '';
  function post(m) { hostPostMessage(m); }
  function safe(e) { var m = (e && e.message) ? String(e.message) : String(e); return /^[\\w .:_-]{1,120}$/.test(m) ? m : 'plugin_error'; }
  var api = {
    registerTool: function (name, handler) { if (typeof name !== 'string' || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(name) || name.length > 160 || typeof handler !== 'function') { throw new Error('invalid_tool_registration'); } if (tools[name]) { throw new Error('duplicate_tool_registration'); } if (toolCount >= 64) { throw new Error('tool_registration_limit'); } tools[name] = handler; toolCount++; },
    host: { call: function (method, args) { return new HostPromise(function (resolve, reject) { if (!currentInvocationId) { reject(new Error('host_call_outside_invocation')); return; } var id = 'h' + (hostSeq++); pendingHost[id] = { resolve: resolve, reject: reject }; post({ type: 'host-call', callId: id, invocationId: currentInvocationId, method: method, args: args }); }); } },
    log: function (level, message) { if (['log','warn','error'].indexOf(level) < 0 || typeof message !== 'string') { throw new Error('invalid_plugin_log'); } post({ type: 'log', level: level, message: message.slice(0, 4000) }); }
  };
  hostAddEventListener('message', async function (ev) {
    var msg = ev.data; if (!msg) return;
    if (msg.type === 'load') {
      if (msg.protocolVersion !== protocolVersion) { post({ type: 'load-error', error: 'plugin_protocol_incompatible' }); return; }
      try { var fn = new Function('yachiyo', msg.entry); await fn(api); post({ type: 'ready', protocolVersion: protocolVersion, tools: objectKeys(tools).map(function (n) { return { name: n, description: n }; }) }); }
      catch (e) { post({ type: 'load-error', error: safe(e) }); }
    } else if (msg.type === 'invoke') {
      var h = tools[msg.name]; if (!h) { post({ type: 'error', callId: msg.callId, error: 'tool_not_found' }); return; }
      currentInvocationId = msg.callId; hostSeq = 0;
      try { var v = await h(msg.args); post({ type: 'result', callId: msg.callId, value: v }); }
      catch (e) { post({ type: 'error', callId: msg.callId, error: safe(e) }); }
      finally { if (currentInvocationId === msg.callId) currentInvocationId = ''; }
    } else if (msg.type === 'host-result') {
      var p = pendingHost[msg.callId]; if (!p) return; delete pendingHost[msg.callId];
      if (msg.ok) { p.resolve(msg.value); } else { p.reject(new Error(msg.error)); }
    }
  });
})();`

export const OPAQUE_PLUGIN_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  'worker-src blob:',
  "connect-src 'none'",
  "font-src 'none'",
  "img-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function serializeInline(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function buildOpaquePluginFrameDocument(channelId: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${OPAQUE_PLUGIN_FRAME_CSP}">
<script>
(function () {
  'use strict';
  var channelId = ${serializeInline(channelId)};
  var workerSource = ${serializeInline(WORKER_BOOTSTRAP_SOURCE)};
  var worker;
  function send(type, payload) {
    parent.postMessage({ channelId: channelId, type: type, payload: payload }, '*');
  }
  try {
    var workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
    worker.onmessage = function (event) { send('worker-message', event.data); };
    worker.onerror = function (event) { send('bridge-error', event.message || 'worker_error'); };
    worker.onmessageerror = function () { send('bridge-error', 'worker_message_error'); };
    addEventListener('message', function (event) {
      var data = event.data;
      if (event.source !== parent || !data || data.channelId !== channelId) return;
      if (data.type === 'terminate') { worker.terminate(); return; }
      if (data.type === 'host-message') worker.postMessage(data.payload);
    });
    send('bridge-ready', null);
  } catch (error) {
    send('bridge-error', error && error.message ? String(error.message) : 'worker_bridge_failed');
  }
})();
<\/script>`
}

function createOpaqueFrameTransport(onError?: (message: string) => void): Transport {
  const handlers = new Set<(message: unknown) => void>()
  const outbound: unknown[] = []
  const inbound: unknown[] = []
  const channelId = `plugin-frame-${crypto.randomUUID()}`
  const iframe = document.createElement('iframe')
  let ready = false
  let terminated = false

  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('tabindex', '-1')
  iframe.referrerPolicy = 'no-referrer'
  iframe.style.display = 'none'

  const deliver = (message: unknown) => {
    if (handlers.size === 0) inbound.push(message)
    else handlers.forEach((handler) => handler(message))
  }
  const postToFrame = (type: 'host-message' | 'terminate', payload?: unknown) => {
    iframe.contentWindow?.postMessage({ channelId, type, payload }, '*')
  }
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return
    const data = event.data as { channelId?: unknown; type?: unknown; payload?: unknown } | null
    if (!data || data.channelId !== channelId) return
    if (data.type === 'bridge-ready') {
      ready = true
      for (const message of outbound.splice(0)) postToFrame('host-message', message)
      return
    }
    if (data.type === 'worker-message') {
      deliver(data.payload)
      return
    }
    if (data.type === 'bridge-error') {
      const message = typeof data.payload === 'string' ? data.payload.slice(0, 120) : 'worker_error'
      onError?.(message)
      deliver({ type: 'load-error', error: message })
    }
  }

  window.addEventListener('message', receive)
  iframe.srcdoc = buildOpaquePluginFrameDocument(channelId)
  ;(document.body ?? document.documentElement).appendChild(iframe)

  return {
    post: (message) => {
      if (terminated) throw new Error('worker_transport_terminated')
      if (ready) postToFrame('host-message', message)
      else if (outbound.length < 256) outbound.push(message)
      else throw new Error('worker_transport_queue_full')
    },
    subscribe: (handler) => {
      handlers.add(handler)
      for (const message of inbound.splice(0)) handler(message)
      return () => {
        handlers.delete(handler)
      }
    },
    terminate: () => {
      if (terminated) return
      terminated = true
      if (ready) postToFrame('terminate')
      window.removeEventListener('message', receive)
      iframe.remove()
      outbound.length = 0
      inbound.length = 0
      handlers.clear()
    },
  }
}

/** Creates a plugin runtime backed by an opaque-origin Worker. No same-origin fallback is allowed. */
export function createBlobWorkerRuntime(
  options: PluginRuntimeOptions & { onWorkerError?: (message: string) => void }
): PluginRuntime {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.createElement) {
    throw new Error('worker_runtime_unavailable')
  }
  return new PluginRuntime(createOpaqueFrameTransport(options.onWorkerError), options)
}
