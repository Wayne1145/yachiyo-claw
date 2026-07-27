import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  defineYachiyoPlugin,
  defineYachiyoPluginView,
  PLUGIN_HOST_METHODS,
  YACHIYO_PLUGIN_PROTOCOL_VERSION,
} from './sdk'

describe('plugin SDK helpers', () => {
  it('publishes a stable RPC protocol version for host handshakes', () => {
    expect(YACHIYO_PLUGIN_PROTOCOL_VERSION).toBe(1)
  })

  it('preserves setup and declarative view values for bundlers', () => {
    const setup = () => undefined
    const view = { schemaVersion: 1 as const, children: [] }
    expect(defineYachiyoPlugin(setup)).toBe(setup)
    expect(defineYachiyoPluginView(view)).toBe(view)
  })

  it('keeps the distributable SDK free of runtime imports', () => {
    const source = readFileSync('src/shared/plugins/sdk.ts', 'utf8')
    expect(source).not.toMatch(/^import (?!type\b)/m)
    expect(PLUGIN_HOST_METHODS).toContain('sandbox.exec')
    expect(PLUGIN_HOST_METHODS).toContain('device.observe')
  })
})
