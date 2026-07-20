import { describe, expect, it, vi } from 'vitest'
import {
  ANDROID_CANONICAL_CAPABILITIES,
  ANDROID_COMPANION_MAX_RESPONSE_BYTES,
  AndroidCompanionConfigurationError,
  AndroidCompanionRegistry,
  AndroidControlAdapter,
  isAllowedCompanionUrl,
  mapCompanionCapability,
} from './android-companion'

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('Android companion connection policy', () => {
  it('allows loopback HTTP and HTTPS endpoints', () => {
    expect(isAllowedCompanionUrl('http://127.0.0.1:8787/control')).toBe(true)
    expect(isAllowedCompanionUrl('http://localhost:8787/control')).toBe(true)
    expect(isAllowedCompanionUrl('http://[::1]:8787/control')).toBe(true)
    expect(isAllowedCompanionUrl('https://companion.example.test/control')).toBe(true)
  })

  it('requires an explicit allowlist entry for a plain HTTP TUN address', () => {
    expect(isAllowedCompanionUrl('http://100.64.12.5:8787/control')).toBe(false)
    expect(
      isAllowedCompanionUrl('http://100.64.12.5:8787/control', {
        allowedTunAddresses: ['100.64.12.5:8787'],
      })
    ).toBe(true)
    expect(
      isAllowedCompanionUrl('http://100.64.12.6:8787/control', {
        allowedTunAddresses: ['100.64.12.0/24'],
      })
    ).toBe(true)
  })

  it('rejects credentials and non-http schemes', () => {
    expect(isAllowedCompanionUrl('http://user:password@127.0.0.1:8787')).toBe(false)
    expect(isAllowedCompanionUrl('ws://127.0.0.1:8787')).toBe(false)
  })

  it('keeps per-capability paths on the validated origin and rejects redirects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ success: true }))
    const adapter = new AndroidControlAdapter({
      protocol: 'yachiyo-http',
      url: 'http://127.0.0.1:8787/control',
      paths: { observe: '/v1/observe' },
      fetch: fetchImpl,
    })

    await adapter.observe()
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8787/v1/observe')
    expect(init.redirect).toBe('error')

    const remotePathAdapter = new AndroidControlAdapter({
      protocol: 'yachiyo-http',
      url: 'http://127.0.0.1:8787/control',
      paths: { observe: 'https://other.example.test/control' },
      fetch: fetchImpl,
    })
    await expect(remotePathAdapter.observe()).rejects.toMatchObject({ code: 'companion_request_path_origin_forbidden' })
  })
})

describe('AndroidControlAdapter', () => {
  it('maps canonical calls without exposing external tool schemas and injects a caller token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ success: true, data: { found: true } }))
    const adapter = new AndroidControlAdapter({
      id: 'yachiyo',
      protocol: 'yachiyo-http',
      url: 'http://127.0.0.1:8787/control',
      fetch: fetchImpl,
    })

    const result = await adapter.find({ selector: { text: '关注' } }, { token: 'caller-token' })
    expect(result).toMatchObject({ success: true, capability: 'find', fallbackToNative: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8787/control')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer caller-token')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ version: 1, capability: 'find' })
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('schema')
  })

  it('maps generic MCP calls to a fixed canonical tool name', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ result: { structuredContent: { ok: true } } }))
    const adapter = new AndroidControlAdapter({
      protocol: 'generic-mcp-http',
      url: 'https://companion.example.test/mcp',
      fetch: fetchImpl,
    })

    await adapter.setText({ selector: { resourceId: 'composer' }, text: 'hello' })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, any>
    expect(body.method).toBe('tools/call')
    expect(body.params.name).toBe('android_set_text')
    expect(body.params).not.toHaveProperty('tools')
    expect(mapCompanionCapability('generic-mcp-http', 'setText')).toBe('android_set_text')
  })

  it('clips UTF-8 responses to 8 KiB', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(JSON.stringify({ output: 'é'.repeat(10_000) })))
    const adapter = new AndroidControlAdapter({
      protocol: 'android-remote-control',
      url: 'http://127.0.0.1:8787/control',
      fetch: fetchImpl,
      disableOnFailure: false,
    })

    const result = await adapter.observe()
    expect(result.truncated).toBe(true)
    expect(result.responseBytes).toBeLessThanOrEqual(ANDROID_COMPANION_MAX_RESPONSE_BYTES)
  })

  it('marks transport failures disabled and emits a native fallback signal', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    const fallback = vi.fn()
    const adapter = new AndroidControlAdapter({
      id: 'remote',
      protocol: 'android-remote-control',
      url: 'http://127.0.0.1:8787/control',
      fetch: fetchImpl,
    })
    adapter.onNativeFallback(fallback)

    const result = await adapter.launch('com.example.app')
    expect(result).toMatchObject({ success: false, fallbackToNative: true, disabled: true })
    expect(adapter.isDisabled()).toBe(true)
    expect(fallback).toHaveBeenCalledWith(expect.objectContaining({
      type: 'android-companion-fallback',
      companionId: 'remote',
      capability: 'launch',
    }))
  })

  it('does not send or disable a companion when the caller has already aborted', async () => {
    const fetchImpl = vi.fn()
    const adapter = new AndroidControlAdapter({
      protocol: 'android-remote-control',
      url: 'http://127.0.0.1:8787/control',
      fetch: fetchImpl,
    })
    const controller = new AbortController()
    controller.abort()

    const result = await adapter.observe({}, { signal: controller.signal })
    expect(result).toMatchObject({ success: false, fallbackToNative: true, disabled: false })
    expect(result.error?.code).toBe('companion_aborted')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(adapter.isDisabled()).toBe(false)
  })

  it('rejects unsupported external capabilities before a network call', async () => {
    const fetchImpl = vi.fn()
    const adapter = new AndroidControlAdapter({
      protocol: 'yachiyo-http',
      url: 'http://127.0.0.1:8787/control',
      fetch: fetchImpl,
    })

    await expect(adapter.call('tap' as never, {})).rejects.toBeInstanceOf(AndroidCompanionConfigurationError)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(adapter.getCanonicalCapabilities()).toEqual([...ANDROID_CANONICAL_CAPABILITIES])
  })
})

describe('AndroidCompanionRegistry', () => {
  it('tries enabled companions in order and surfaces the last native fallback result', async () => {
    const first = new AndroidControlAdapter({
      id: 'first',
      protocol: 'yachiyo-http',
      url: 'http://127.0.0.1:8787/control',
      fetch: vi.fn().mockRejectedValue(new Error('offline')),
    })
    const second = new AndroidControlAdapter({
      id: 'second',
      protocol: 'android-remote-control',
      url: 'http://127.0.0.1:8788/control',
      fetch: vi.fn().mockResolvedValue(response({ success: true, data: { packageName: 'com.example' } })),
    })
    const registry = new AndroidCompanionRegistry({ adapters: [first, second] })

    const result = await registry.launch('com.example')
    expect(result.success).toBe(true)
    expect(result.companionId).toBe('second')
    expect(first.isDisabled()).toBe(true)
  })

  it('emits fallback when no companion remains', async () => {
    const fallback = vi.fn()
    const adapter = new AndroidControlAdapter({
      id: 'only',
      protocol: 'yachiyo-http',
      url: 'http://127.0.0.1:8787/control',
      fetch: vi.fn().mockRejectedValue(new Error('offline')),
    })
    const registry = new AndroidCompanionRegistry({ adapters: [adapter], onNativeFallback: fallback })

    await registry.observe()
    const result = await registry.observe()
    expect(result.error?.code).toBe('companion_unavailable')
    expect(result.fallbackToNative).toBe(true)
    expect(fallback).toHaveBeenCalled()
    expect(registry.getLastFallbackSignal()).toEqual(expect.objectContaining({ companionId: 'only' }))
  })
})
