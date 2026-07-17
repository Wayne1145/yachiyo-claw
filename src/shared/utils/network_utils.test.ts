import { describe, expect, it } from 'vitest'
import { isLocalHost } from './network_utils'

describe('isLocalHost', () => {
  it('detects localhost', () => {
    expect(isLocalHost('http://localhost')).toBe(true)
    expect(isLocalHost('http://localhost:3000')).toBe(true)
    expect(isLocalHost('https://localhost/api')).toBe(true)
  })

  it('detects IPv4 loopback', () => {
    expect(isLocalHost('http://127.0.0.1')).toBe(true)
    expect(isLocalHost('http://127.0.0.1:8080')).toBe(true)
    expect(isLocalHost('http://127.255.255.255')).toBe(true)
  })

  it('detects IPv6 loopback', () => {
    expect(isLocalHost('http://[::1]')).toBe(true)
  })

  it('detects 192.168.x.x private range', () => {
    expect(isLocalHost('http://192.168.1.1')).toBe(true)
    expect(isLocalHost('http://192.168.0.100:8080')).toBe(true)
  })

  it('detects 10.x.x.x private range', () => {
    expect(isLocalHost('http://10.0.0.1')).toBe(true)
    expect(isLocalHost('http://10.255.255.255')).toBe(true)
  })

  it('detects 172.16-31.x.x private range', () => {
    expect(isLocalHost('http://172.16.0.1')).toBe(true)
    expect(isLocalHost('http://172.31.255.255')).toBe(true)
  })

  it('rejects 172.x outside 16-31 range', () => {
    expect(isLocalHost('http://172.15.0.1')).toBe(false)
    expect(isLocalHost('http://172.32.0.1')).toBe(false)
  })

  it('returns false for public hosts', () => {
    expect(isLocalHost('https://api.openai.com')).toBe(false)
    expect(isLocalHost('https://google.com')).toBe(false)
    expect(isLocalHost('https://8.8.8.8')).toBe(false)
  })

  it('returns false for malformed URLs', () => {
    expect(isLocalHost('not-a-url')).toBe(false)
    expect(isLocalHost('')).toBe(false)
  })
})
