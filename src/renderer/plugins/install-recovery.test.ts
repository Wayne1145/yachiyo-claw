import { describe, expect, it } from 'vitest'
import { pendingPluginIdentityMatches } from './install-recovery'

describe('pending plugin install identity recovery', () => {
  it('accepts URL updates that constrain only plugin id', () => {
    expect(pendingPluginIdentityMatches({ id: 'ubuntu-runtime' }, { id: 'ubuntu-runtime', version: '1.2.0' })).toBe(true)
  })

  it('still requires exact marketplace versions and plugin ids', () => {
    expect(
      pendingPluginIdentityMatches(
        { id: 'ubuntu-runtime', version: '1.0.0' },
        { id: 'ubuntu-runtime', version: '1.0.1' },
      ),
    ).toBe(false)
    expect(pendingPluginIdentityMatches({ id: 'ubuntu-runtime' }, { id: 'other-plugin', version: '1.0.0' })).toBe(false)
  })
})
