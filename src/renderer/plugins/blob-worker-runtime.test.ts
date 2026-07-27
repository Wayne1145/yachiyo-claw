// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  BLOCKED_PLUGIN_AMBIENT_GLOBALS,
  buildOpaquePluginFrameDataUrl,
  buildOpaquePluginFrameDocument,
  createBlobWorkerRuntime,
  OPAQUE_PLUGIN_FRAME_CSP,
} from './blob-worker-runtime'

afterEach(() => {
  document.body.replaceChildren()
})

describe('opaque plugin Worker bridge', () => {
  it('uses an opaque data document and removes it when the runtime is disposed', () => {
    const runtime = createBlobWorkerRuntime({ hostApi: {}, authorize: () => ({ allowed: false, reason: 'denied' }) })
    const frame = document.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.hasAttribute('sandbox')).toBe(false)
    expect(frame?.src).toMatch(/^data:text\/html;base64,/)
    expect(atob(frame?.src.split(',')[1] ?? '')).toContain(OPAQUE_PLUGIN_FRAME_CSP)
    runtime.dispose()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('pins a no-egress CSP into the bridge document', () => {
    const documentSource = buildOpaquePluginFrameDocument('test-channel')
    expect(documentSource).toContain("default-src 'none'")
    expect(documentSource).toContain("connect-src 'none'")
    expect(documentSource).toContain("font-src 'none'")
    expect(documentSource).toContain('worker-src blob:')
    expect(documentSource).not.toContain('allow-same-origin')
    expect(documentSource).not.toContain('worker = new Worker(workerUrl);\n    URL.revokeObjectURL(workerUrl)')
    expect(documentSource).toContain("worker.onmessage = function (event) { revokeWorkerUrl()")
    expect(buildOpaquePluginFrameDataUrl('test-channel')).toMatch(/^data:text\/html;base64,/)
  })

  it('removes delayed scheduling primitives that could borrow a later invocation context', () => {
    for (const name of [
      'setTimeout',
      'setInterval',
      'queueMicrotask',
      'MessageChannel',
      'scheduler',
      'SharedArrayBuffer',
      'Atomics',
    ]) {
      expect(BLOCKED_PLUGIN_AMBIENT_GLOBALS).toContain(name)
    }
  })
})
