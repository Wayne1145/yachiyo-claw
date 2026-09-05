import { describe, expect, it } from 'vitest'
import { parsePluginManifest, PLUGIN_CAPABILITIES } from './manifest'

const SHA = 'a'.repeat(64)
const OTHER_SHA = 'b'.repeat(64)

function base(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: 'my-plugin',
    version: '1.0.0',
    displayName: 'My Plugin',
    description: 'A test plugin',
    entry: 'main.js',
    entrySha256: SHA,
    capabilities: [] as unknown[],
    contributions: {} as Record<string, unknown>,
    files: [{ path: 'main.js', size: 100, sha256: SHA }],
    ...over,
  }
}

describe('parsePluginManifest', () => {
  it('accepts a minimal valid scripted manifest', () => {
    const manifest = parsePluginManifest(base())
    expect(manifest.id).toBe('my-plugin')
    expect(manifest.entry).toBe('main.js')
  })

  it('exposes the seven capabilities', () => {
    expect(PLUGIN_CAPABILITIES).toEqual(['storage', 'ui', 'tools', 'sandbox', 'linux-runtime', 'network', 'device'])
  })

  it('reserves linux-runtime for the official Ubuntu plugin id', () => {
    const manifest = base({
      capabilities: [{ name: 'linux-runtime', reason: 'Manage the official Ubuntu runtime image.' }],
    })
    expect(() => parsePluginManifest(manifest)).toThrow(/reserved for the official Ubuntu runtime/i)
    manifest.id = 'ubuntu-runtime'
    expect(parsePluginManifest(manifest).capabilities[0].name).toBe('linux-runtime')
  })

  it('rejects a non-kebab-case id', () => {
    expect(() => parsePluginManifest(base({ id: 'My_Plugin' }))).toThrow()
  })

  it('rejects unknown fields (strict)', () => {
    expect(() => parsePluginManifest(base({ bogusField: 1 }))).toThrow()
  })

  it('rejects control and bidirectional override characters in management text', () => {
    for (const displayName of ['line one\nline two', 'trusted\u202eevil']) {
      expect(() => parsePluginManifest(base({ displayName }))).toThrow(/unsafe control characters/)
    }
  })

  it('rejects entry path traversal in all forms', () => {
    for (const entry of ['../evil.js', '/abs/main.js', 'C:\\main.js', 'a\\b.js', 'a/../b.js', './main.js']) {
      expect(() => parsePluginManifest(base({ entry, files: [{ path: entry, size: 1, sha256: SHA }] }))).toThrow()
    }
  })

  it('rejects an entry not listed in files[]', () => {
    expect(() => parsePluginManifest(base({ files: [{ path: 'other.js', size: 1, sha256: SHA }] }))).toThrow(
      /not listed in files/
    )
  })

  it('rejects an entrySha256 that disagrees with files[]', () => {
    expect(() => parsePluginManifest(base({ entrySha256: OTHER_SHA }))).toThrow(/does not match/)
  })

  it('rejects an unsafe files[] path even when it is not the entry', () => {
    expect(() =>
      parsePluginManifest(
        base({
          files: [
            { path: 'main.js', size: 1, sha256: SHA },
            { path: '../leak', size: 1 },
          ],
        })
      )
    ).toThrow()
  })

  it('requires a digest for every installed file', () => {
    expect(() => parsePluginManifest(base({ files: [{ path: 'main.js', size: 100 }] }))).toThrow(/must carry a sha256/)
  })

  it('rejects blank, near-empty, and too-short capability reasons', () => {
    for (const reason of ['', '   ', '需要', 'short']) {
      expect(() => parsePluginManifest(base({ capabilities: [{ name: 'storage', reason }] }))).toThrow()
    }
  })

  it('accepts a meaningful capability reason', () => {
    expect(() =>
      parsePluginManifest(base({ capabilities: [{ name: 'storage', reason: 'persist user preferences locally' }] }))
    ).not.toThrow()
  })

  it('requires a domain allow-list for the network capability and rejects wildcards', () => {
    const net = (domains: unknown) =>
      base({ capabilities: [{ name: 'network', reason: 'call the weather api', domains }] })
    expect(() =>
      parsePluginManifest(base({ capabilities: [{ name: 'network', reason: 'call the weather api' }] }))
    ).toThrow()
    expect(() => parsePluginManifest(net(['*']))).toThrow()
    expect(() => parsePluginManifest(net(['*.example.com']))).toThrow()
    expect(() => parsePluginManifest(net(['api.example.com']))).not.toThrow()
    expect(() => parsePluginManifest(net(['localhost.local']))).toThrow(/Private or local-only/)
    expect(() => parsePluginManifest(net(['api.example.com', 'API.EXAMPLE.COM']))).toThrow(/duplicate domains/)
  })

  it('rejects duplicate capabilities and tool declarations', () => {
    const storage = { name: 'storage', reason: 'persist plugin preferences locally' }
    expect(() => parsePluginManifest(base({ capabilities: [storage, storage] }))).toThrow(/more than once/)
    const tool = { name: 'my-plugin_echo', description: 'echo the input data' }
    expect(() =>
      parsePluginManifest(
        base({
          capabilities: [{ name: 'tools', reason: 'provide an echo tool' }],
          contributions: { tools: [tool, tool] },
        })
      )
    ).toThrow(/more than once/)
  })

  it('rejects a non-network capability that declares domains', () => {
    expect(() =>
      parsePluginManifest(
        base({ capabilities: [{ name: 'storage', reason: 'store things locally', domains: ['x.com'] }] })
      )
    ).toThrow()
  })

  it('requires the ui capability for a tab and namespaces the route', () => {
    const tab = { label: 'Home', route: '/plugin/my-plugin', order: 1 }
    expect(() => parsePluginManifest(base({ contributions: { tab } }))).toThrow(/requires the "ui" capability/)
    expect(() =>
      parsePluginManifest(
        base({
          capabilities: [{ name: 'ui', reason: 'render a settings panel' }],
          contributions: { tab: { ...tab, route: '/settings' } },
        })
      )
    ).toThrow(/must start with/)
    expect(() =>
      parsePluginManifest(
        base({ capabilities: [{ name: 'ui', reason: 'render a settings panel' }], contributions: { tab } })
      )
    ).not.toThrow()
  })

  it('requires a digest-pinned, declared file for a bundled view', () => {
    const view = { path: 'ui/main.json', size: 100, sha256: OTHER_SHA }
    expect(() =>
      parsePluginManifest(base({ contributions: { view: view.path }, files: [base().files[0], view] }))
    ).toThrow(/requires the "ui" capability/)
    expect(() =>
      parsePluginManifest(
        base({
          capabilities: [{ name: 'ui', reason: 'render a settings panel' }],
          contributions: { view: view.path },
          files: [base().files[0], view],
        })
      )
    ).not.toThrow()
    expect(() =>
      parsePluginManifest(
        base({ capabilities: [{ name: 'ui', reason: 'render a settings panel' }], contributions: { view: view.path } })
      )
    ).toThrow(/not listed/)
  })

  it('requires the tools capability and an id-prefixed tool name', () => {
    const tool = { name: 'weather', description: 'get weather' }
    expect(() => parsePluginManifest(base({ contributions: { tools: [tool] } }))).toThrow(
      /requires the "tools" capability/
    )
    expect(() =>
      parsePluginManifest(
        base({ capabilities: [{ name: 'tools', reason: 'provide a weather tool' }], contributions: { tools: [tool] } })
      )
    ).toThrow(/must be prefixed/)
    expect(() =>
      parsePluginManifest(
        base({
          capabilities: [{ name: 'tools', reason: 'provide a weather tool' }],
          contributions: { tools: [{ name: 'my-plugin_weather', description: 'get weather' }] },
        })
      )
    ).not.toThrow()
  })

  it('gives a readable error when minAppVersion is newer than the app', () => {
    expect(() => parsePluginManifest(base({ minAppVersion: '99.0.0' }), { appVersion: '0.0.11' })).toThrow(/99\.0\.0/)
    expect(() => parsePluginManifest(base({ minAppVersion: '0.0.1' }), { appVersion: '0.0.11' })).not.toThrow()
  })

  it('supports a declarative plugin with no entry and rejects contradictions', () => {
    const declarative = {
      schemaVersion: 1,
      id: 'themey',
      version: '1.0.0',
      displayName: 'Declarative',
      description: 'UI only',
      capabilities: [{ name: 'ui', reason: 'contribute a settings page' }],
      contributions: {
        settingsEntries: [{ group: 'app', label: 'X', detail: 'y', route: '/plugin/themey', order: 1 }],
      },
      files: [{ path: 'README.md', size: 10, sha256: SHA }],
    }
    expect(() => parsePluginManifest(declarative)).not.toThrow()
    // Declarative but with an entry -> contradiction.
    expect(() =>
      parsePluginManifest({
        ...declarative,
        mode: 'declarative',
        entry: 'main.js',
        entrySha256: SHA,
        files: [{ path: 'main.js', size: 1, sha256: SHA }],
      })
    ).toThrow()
    // Declarative but contributing tools -> impossible (no code).
    expect(() =>
      parsePluginManifest({
        ...declarative,
        capabilities: [{ name: 'tools', reason: 'provide tools somehow' }],
        contributions: { tools: [{ name: 'themey_x', description: 'x' }] },
      })
    ).toThrow()
  })
})
