import { Capacitor, CapacitorHttp } from '@capacitor/core'

export interface Sub2ApiBilling {
  multiplier?: number
  balance?: number
  remaining?: number
  scope?: string
  at: number
}

export function sub2ApiEndpoints(host: string): { billing: string; usage: string } {
  const url = new URL(host)
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  ) {
    throw new Error('HTTPS is required for billing credentials')
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid API host')
  const base = url.href.replace(/\/(?:chat\/completions|responses)\/?$/, '').replace(/\/$/, '')
  const v1 = base.endsWith('/v1') ? base : `${base}/v1`
  return { billing: `${v1}/sub2api/billing`, usage: `${v1}/usage` }
}

export function parseSub2ApiBilling(billing: unknown, usage: unknown, now = Date.now()): Sub2ApiBilling {
  const b = billing && typeof billing === 'object' ? (billing as Record<string, unknown>) : {}
  const u = usage && typeof usage === 'object' ? (usage as Record<string, unknown>) : {}
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  return {
    multiplier:
      b.object === 'sub2api.key_billing'
        ? number(b.effective_rate_multiplier ?? b.resolved_rate_multiplier ?? b.group_rate_multiplier)
        : undefined,
    balance: number(u.balance),
    remaining: number(u.remaining),
    scope:
      u.mode === 'quota_limited'
        ? 'key-quota'
        : u.subscription
          ? 'subscription'
          : u.balance !== undefined
            ? 'wallet'
            : undefined,
    at: now,
  }
}

export async function fetchSub2ApiBilling(host: string, apiKey: string): Promise<Sub2ApiBilling> {
  if (!apiKey.trim()) throw new Error('API key required')
  const endpoints = sub2ApiEndpoints(host)
  const read = async (url: string) => {
    if (Capacitor.isNativePlatform()) {
      const response = await CapacitorHttp.request({
        url,
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        responseType: 'json',
        connectTimeout: 12000,
        readTimeout: 12000,
        disableRedirects: true,
      })
      return response.status === 200 ? response.data : undefined
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    return response.ok ? response.json() : undefined
  }
  const results = await Promise.allSettled([read(endpoints.billing), read(endpoints.usage)])
  const result = parseSub2ApiBilling(
    results[0].status === 'fulfilled' ? results[0].value : undefined,
    results[1].status === 'fulfilled' ? results[1].value : undefined
  )
  if (result.multiplier === undefined && result.balance === undefined && result.remaining === undefined)
    throw new Error('上游未提供 sub2api 账单接口，或密钥无权访问')
  return result
}
