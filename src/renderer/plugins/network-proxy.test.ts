import { describe, expect, it, vi } from 'vitest'
import { PLUGIN_FETCH_LIMITS, PluginNetworkQuota, pluginFetch } from './network-proxy'

const allowed = ['api.example.com', 'cdn.example.org']

function fetchStub(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const handler = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1]
    if (!handler) throw new Error(`no route for ${url}`)
    return handler()
  }) as unknown as typeof fetch
}

describe('pluginFetch', () => {
  it('performs an allowed https request and returns pure data', async () => {
    const impl = fetchStub({
      'https://api.example.com/v1': () =>
        new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    })
    const result = await pluginFetch({ url: 'https://api.example.com/v1' }, allowed, impl)
    expect(result).toMatchObject({ status: 200, body: '{"ok":true}', truncated: false })
  })

  it('denies off-list, http, credentialed, and empty-grant requests', async () => {
    const impl = fetchStub({})
    await expect(pluginFetch({ url: 'https://evil.com/' }, allowed, impl)).rejects.toThrow(
      'egress_denied:domain_not_allowed'
    )
    await expect(pluginFetch({ url: 'http://api.example.com/' }, allowed, impl)).rejects.toThrow(
      'egress_denied:insecure_scheme'
    )
    await expect(pluginFetch({ url: 'https://u:p@api.example.com/' }, allowed, impl)).rejects.toThrow(
      'egress_denied:embedded_credentials'
    )
    await expect(pluginFetch({ url: 'https://api.example.com/' }, [], impl)).rejects.toThrow('no_domains_granted')
  })

  it('validates every redirect hop and follows only within the allow-list', async () => {
    const impl = fetchStub({
      'https://api.example.com/start': () =>
        new Response(null, { status: 302, headers: { location: 'https://cdn.example.org/data' } }),
      'https://cdn.example.org/data': () => new Response('moved-ok', { status: 200 }),
    })
    const result = await pluginFetch({ url: 'https://api.example.com/start' }, allowed, impl)
    expect(result.body).toBe('moved-ok')
    expect(result.finalUrl).toBe('https://cdn.example.org/data')
  })

  it('rejects a redirect that leaves the allow-list', async () => {
    const impl = fetchStub({
      'https://api.example.com/start': () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.com/steal' } }),
    })
    await expect(pluginFetch({ url: 'https://api.example.com/start' }, allowed, impl)).rejects.toThrow(
      'egress_denied:domain_not_allowed'
    )
  })

  it('degrades to a bodyless GET after a redirect so the body is never re-sent', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      if (String(input).includes('/start'))
        return new Response(null, { status: 307, headers: { location: 'https://cdn.example.org/next' } })
      return new Response('done', { status: 200 })
    }) as unknown as typeof fetch
    await pluginFetch({ url: 'https://api.example.com/start', method: 'POST', body: 'secret' }, allowed, impl)
    expect(calls[0].init?.body).toBe('secret')
    expect(calls[1].init?.method).toBe('GET')
    expect(calls[1].init?.body).toBeUndefined()
  })

  it('caps redirect hops', async () => {
    const impl = fetchStub({
      'https://api.example.com/': () =>
        new Response(null, { status: 302, headers: { location: 'https://api.example.com/loop' } }),
    })
    await expect(pluginFetch({ url: 'https://api.example.com/loop' }, allowed, impl)).rejects.toThrow(
      'too_many_redirects'
    )
  })

  it('whitelists methods and request headers', async () => {
    const impl = fetchStub({})
    await expect(pluginFetch({ url: 'https://api.example.com/', method: 'TRACE' }, allowed, impl)).rejects.toThrow(
      'method_not_allowed'
    )
    const seen: RequestInit[] = []
    const capture = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init ?? {})
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch
    await pluginFetch(
      {
        url: 'https://api.example.com/',
        headers: { 'X-Api-Key': 'k', Cookie: 'session=steal', Origin: 'https://spoof' },
      },
      allowed,
      capture
    )
    expect(seen[0].headers).toEqual({ 'x-api-key': 'k' })
  })

  it('bounds request body and truncates oversized responses', async () => {
    const impl = fetchStub({})
    await expect(
      pluginFetch(
        { url: 'https://api.example.com/', method: 'POST', body: 'x'.repeat(PLUGIN_FETCH_LIMITS.maxBodyBytes + 1) },
        allowed,
        impl
      )
    ).rejects.toThrow('body_too_large')

    const big = (async () =>
      new Response('y'.repeat(PLUGIN_FETCH_LIMITS.maxResponseBytes + 100), { status: 200 })) as unknown as typeof fetch
    const result = await pluginFetch({ url: 'https://api.example.com/' }, allowed, big)
    expect(result.truncated).toBe(true)
    expect(result.body.length).toBe(PLUGIN_FETCH_LIMITS.maxResponseBytes)
  })

  it('bounds URLs and allowed request headers before dispatch', async () => {
    const impl = fetchStub({})
    await expect(
      pluginFetch({ url: `https://api.example.com/?q=${'x'.repeat(PLUGIN_FETCH_LIMITS.maxUrlChars)}` }, allowed, impl)
    ).rejects.toThrow('url_too_large')
    await expect(
      pluginFetch(
        {
          url: 'https://api.example.com/',
          headers: { Authorization: 'x'.repeat(PLUGIN_FETCH_LIMITS.maxHeaderBytes + 1) },
        },
        allowed,
        impl
      )
    ).rejects.toThrow('headers_too_large')
    await expect(
      pluginFetch(
        { url: 'https://api.example.com/', headers: { Authorization: 'token\r\nX-Evil: yes' } },
        allowed,
        impl
      )
    ).rejects.toThrow('header_value_invalid')
    expect(impl).not.toHaveBeenCalled()
  })

  it('enforces a rolling per-plugin request rate limit', async () => {
    const quota = new PluginNetworkQuota()
    const impl = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch
    for (let index = 0; index < PLUGIN_FETCH_LIMITS.maxRequestsPerMinute; index++) {
      await pluginFetch({ url: 'https://api.example.com/' }, allowed, impl, quota)
    }
    await expect(pluginFetch({ url: 'https://api.example.com/' }, allowed, impl, quota)).rejects.toThrow(
      'network_rate_limit_exceeded'
    )
  })

  it('blocks subsequent traffic after the hourly response-byte budget is consumed', async () => {
    const quota = new PluginNetworkQuota()
    const payload = 'x'.repeat(PLUGIN_FETCH_LIMITS.maxResponseBytes)
    const impl = (async () => new Response(payload, { status: 200 })) as unknown as typeof fetch
    const requests = Math.floor(PLUGIN_FETCH_LIMITS.maxResponseBytesPerHour / PLUGIN_FETCH_LIMITS.maxResponseBytes)
    for (let index = 0; index < requests; index++) {
      await pluginFetch({ url: 'https://api.example.com/' }, allowed, impl, quota)
    }
    await expect(pluginFetch({ url: 'https://api.example.com/' }, allowed, impl, quota)).rejects.toThrow(
      'network_byte_quota_exceeded'
    )
  })

  it('cancels an in-flight request when the invocation aborts', async () => {
    const controller = new AbortController()
    const impl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        })
      })) as unknown as typeof fetch
    const pending = pluginFetch({ url: 'https://api.example.com/' }, allowed, impl, undefined, {
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toThrow('fetch_cancelled')
  })
})
