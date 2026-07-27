/**
 * Plugin network egress policy (platform-22 pure core).
 *
 * The opaque plugin frame denies ambient egress. This module is the pure matcher + per-hop redirect
 * validator used by the only supported network path: the web host proxy and Android's native
 * DNS-aware proxy. Matching is exact and case-insensitive — no wildcard,
 * no subdomain widening — mirroring the manifest which already rejects wildcards.
 */

/** Exact, case-insensitive host membership. No wildcard or subdomain expansion. */
export function isHostAllowed(host: string, allowed: readonly string[]): boolean {
  const target = host.trim().toLowerCase()
  if (!target) return false
  return allowed.some((domain) => domain.trim().toLowerCase() === target)
}

export type UrlDecision = { ok: true; host: string } | { ok: false; reason: string }

const LOCAL_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa']

/** Rejects literal/private and local-only names before they can reach the platform HTTP stack. */
export function isPrivateNetworkHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (!normalized || normalized === 'localhost' || LOCAL_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix)))
    return true
  if (normalized.includes(':')) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized)
    )
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) return false
  const parts = normalized.split('.').map(Number)
  if (parts.some((part) => part > 255)) return true
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** Validates a single request URL: https only, parseable, and its host in the allow-list. */
export function validateRequestUrl(url: string, allowed: readonly string[]): UrlDecision {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'insecure_scheme' }
  if (parsed.username || parsed.password) return { ok: false, reason: 'embedded_credentials' }
  if (isPrivateNetworkHost(parsed.hostname)) return { ok: false, reason: 'private_network_denied' }
  if (!isHostAllowed(parsed.hostname, allowed)) return { ok: false, reason: 'domain_not_allowed' }
  return { ok: true, host: parsed.hostname }
}

export type RedirectDecision = { ok: true } | { ok: false; reason: string; hop: number }

/**
 * Validates every hop of a manually-followed redirect chain. Automatic redirect following would let a
 * first-party allowed host bounce the request to an off-list host, so each hop is re-checked here.
 */
export function validateRedirectChain(
  urls: readonly string[],
  allowed: readonly string[],
  maxHops = 5,
): RedirectDecision {
  if (urls.length === 0) return { ok: false, reason: 'empty_chain', hop: 0 }
  if (urls.length > maxHops + 1) return { ok: false, reason: 'too_many_redirects', hop: urls.length - 1 }
  for (let index = 0; index < urls.length; index++) {
    const decision = validateRequestUrl(urls[index], allowed)
    if (!decision.ok) return { ok: false, reason: decision.reason, hop: index }
  }
  return { ok: true }
}
