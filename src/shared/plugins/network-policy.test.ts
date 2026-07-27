import { describe, expect, it } from 'vitest'
import { isHostAllowed, isPrivateNetworkHost, validateRedirectChain, validateRequestUrl } from './network-policy'

const allowed = ['api.example.com', 'cdn.example.org']

describe('isHostAllowed', () => {
  it('matches exactly and case-insensitively, never by subdomain', () => {
    expect(isHostAllowed('api.example.com', allowed)).toBe(true)
    expect(isHostAllowed('API.Example.com', allowed)).toBe(true)
    expect(isHostAllowed('evil.api.example.com', allowed)).toBe(false)
    expect(isHostAllowed('example.com', allowed)).toBe(false)
    expect(isHostAllowed('', allowed)).toBe(false)
  })
})

describe('validateRequestUrl', () => {
  it('accepts an https URL to an allowed host', () => {
    expect(validateRequestUrl('https://api.example.com/v1/data', allowed)).toEqual({
      ok: true,
      host: 'api.example.com',
    })
  })
  it('rejects non-https, unparseable, off-list, and credential-bearing URLs', () => {
    expect(validateRequestUrl('http://api.example.com', allowed)).toEqual({ ok: false, reason: 'insecure_scheme' })
    expect(validateRequestUrl('not a url', allowed)).toEqual({ ok: false, reason: 'invalid_url' })
    expect(validateRequestUrl('https://evil.com', allowed)).toEqual({ ok: false, reason: 'domain_not_allowed' })
    expect(validateRequestUrl('https://user:pass@api.example.com', allowed)).toEqual({
      ok: false,
      reason: 'embedded_credentials',
    })
  })
  it('rejects private, loopback, link-local, and local-only targets', () => {
    for (const host of [
      '127.0.0.1',
      '10.0.0.8',
      '172.16.2.3',
      '192.168.1.1',
      '169.254.10.2',
      'localhost',
      'printer.local',
    ]) {
      expect(isPrivateNetworkHost(host)).toBe(true)
    }
    expect(isPrivateNetworkHost('8.8.8.8')).toBe(false)
    expect(validateRequestUrl('https://127.0.0.1/admin', ['127.0.0.1'])).toEqual({
      ok: false,
      reason: 'private_network_denied',
    })
  })
})

describe('validateRedirectChain', () => {
  it('accepts a chain whose every hop is allowed', () => {
    expect(validateRedirectChain(['https://api.example.com/a', 'https://cdn.example.org/b'], allowed)).toEqual({
      ok: true,
    })
  })
  it('rejects the hop that leaves the allow-list', () => {
    expect(validateRedirectChain(['https://api.example.com/a', 'https://evil.com/b'], allowed)).toEqual({
      ok: false,
      reason: 'domain_not_allowed',
      hop: 1,
    })
  })
  it('rejects an empty chain and an over-long chain', () => {
    expect(validateRedirectChain([], allowed).ok).toBe(false)
    const long = Array.from({ length: 8 }, () => 'https://api.example.com/x')
    expect(validateRedirectChain(long, allowed)).toEqual({ ok: false, reason: 'too_many_redirects', hop: 7 })
  })
})
