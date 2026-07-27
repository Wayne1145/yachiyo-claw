// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { buildOpaquePluginFrameDocument, createBlobWorkerRuntime, OPAQUE_PLUGIN_FRAME_CSP } from './blob-worker-runtime'

afterEach(() => {
  document.body.replaceChildren()
})

describe('opaque plugin Worker bridge', () => {
  it('uses an opaque sandbox and removes it when the runtime is disposed', () => {
    const runtime = createBlobWorkerRuntime({ hostApi: {}, authorize: () => ({ allowed: false, reason: 'denied' }) })
    const frame = document.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame?.srcdoc).toContain(OPAQUE_PLUGIN_FRAME_CSP)
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
  })
})
