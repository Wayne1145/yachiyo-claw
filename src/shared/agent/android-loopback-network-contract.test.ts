import { readFileSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { describe, expect, it } from 'vitest'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })

describe('Android local preview network policy', () => {
  it('keeps external cleartext traffic disabled and allows only loopback previews', () => {
    const manifest = parser.parse(readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')).manifest
    expect(manifest.application['android:usesCleartextTraffic']).toBe('false')
    expect(manifest.application['android:networkSecurityConfig']).toBe('@xml/network_security_config')

    const config = parser.parse(
      readFileSync('android/app/src/main/res/xml/network_security_config.xml', 'utf8')
    )['network-security-config']
    expect(config['base-config'].cleartextTrafficPermitted).toBe('false')
    expect(config['domain-config'].cleartextTrafficPermitted).toBe('true')
    expect(config['domain-config'].domain).toEqual([
      { '#text': 'localhost', includeSubdomains: 'false' },
      { '#text': '127.0.0.1', includeSubdomains: 'false' },
    ])
  })
})
