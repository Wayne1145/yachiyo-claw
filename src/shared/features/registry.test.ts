import { afterEach, describe, expect, it } from 'vitest'
import { TOOL_IDS } from '../agent/tool-ids'
import { type FeatureManifest, FeatureManifestSchema, resolveCurrentFeaturePlatform } from './contract'
import { isPrivilegedToolId } from './privileged-tools'
import {
  getAllFeatures,
  hasFeature,
  registerFeature,
  resetFeatureRegistry,
  resolveEnabledFeatures,
  resolveFeatureOrder,
} from './registry'

function manifest(over: Partial<FeatureManifest> & Pick<FeatureManifest, 'id'>): FeatureManifest {
  return {
    displayName: 'X',
    description: 'x',
    platforms: ['android'],
    trust: 'inert',
    enabledByDefault: true,
    ...over,
  }
}

afterEach(() => resetFeatureRegistry())

describe('resolveCurrentFeaturePlatform', () => {
  it('folds mobile + android build into android', () => {
    expect(resolveCurrentFeaturePlatform({ platformType: 'mobile', buildPlatform: 'android' })).toBe('android')
  })
  it('maps desktop and everything else', () => {
    expect(resolveCurrentFeaturePlatform({ platformType: 'desktop' })).toBe('desktop')
    expect(resolveCurrentFeaturePlatform({ platformType: 'mobile' })).toBe('web') // mobile without android build
    expect(resolveCurrentFeaturePlatform({ platformType: 'web' })).toBe('web')
  })
})

describe('FeatureManifestSchema', () => {
  it('rejects a non-kebab-case id', () => {
    expect(() => FeatureManifestSchema.parse(manifest({ id: 'Not_Kebab' }))).toThrow()
  })
  it('rejects empty platforms', () => {
    expect(() => FeatureManifestSchema.parse(manifest({ id: 'a', platforms: [] as never }))).toThrow()
  })
  it('rejects an unknown trust', () => {
    expect(() => FeatureManifestSchema.parse(manifest({ id: 'a', trust: 'godmode' as never }))).toThrow()
  })
  it('rejects unknown fields (strict)', () => {
    expect(() => FeatureManifestSchema.parse({ ...manifest({ id: 'a' }), extra: 1 })).toThrow()
  })
  it('rejects a toolId that violates the broker grammar', () => {
    expect(() => FeatureManifestSchema.parse(manifest({ id: 'a', toolIds: ['Bad Id'] }))).toThrow()
  })
})

describe('registerFeature', () => {
  it('registers a valid manifest and rejects duplicate ids', () => {
    registerFeature(manifest({ id: 'alpha' }))
    expect(hasFeature('alpha')).toBe(true)
    expect(() => registerFeature(manifest({ id: 'alpha' }))).toThrow(/already registered/)
    expect(getAllFeatures()).toHaveLength(1)
  })

  it('rejects privilege escalation by a non-privileged module', () => {
    expect(isPrivilegedToolId(TOOL_IDS.SHELL_EXEC)).toBe(true)
    expect(() =>
      registerFeature(manifest({ id: 'sneaky', trust: 'sandboxed', toolIds: [TOOL_IDS.SHELL_EXEC] })),
    ).toThrow(/cannot declare privileged tool ids/)
    expect(() => registerFeature(manifest({ id: 'sneaky2', trust: 'inert', toolIds: [TOOL_IDS.UI_TAP] }))).toThrow()
  })

  it('allows a privileged module to declare privileged tool ids', () => {
    expect(() =>
      registerFeature(
        manifest({ id: 'device-agent', trust: 'privileged', toolIds: [TOOL_IDS.SHELL_EXEC, TOOL_IDS.UI_TAP] }),
      ),
    ).not.toThrow()
  })
})

describe('resolveFeatureOrder', () => {
  it('orders dependencies before dependents', () => {
    const order = resolveFeatureOrder([manifest({ id: 'app', requires: ['base'] }), manifest({ id: 'base' })]).map(
      (m) => m.id,
    )
    expect(order.indexOf('base')).toBeLessThan(order.indexOf('app'))
  })
  it('throws on an unknown requirement', () => {
    expect(() => resolveFeatureOrder([manifest({ id: 'app', requires: ['ghost'] })])).toThrow(
      /Unknown required feature/,
    )
  })
  it('throws on a cycle and names the ids on it', () => {
    expect(() =>
      resolveFeatureOrder([manifest({ id: 'a', requires: ['b'] }), manifest({ id: 'b', requires: ['a'] })]),
    ).toThrow(/cycle: a -> b -> a|cycle: b -> a -> b/)
  })
})

describe('resolveEnabledFeatures', () => {
  it('filters out platform-mismatched modules even when enabledByDefault', () => {
    const result = resolveEnabledFeatures([manifest({ id: 'desktop-only', platforms: ['desktop'] })], {
      platform: 'android',
    })
    expect(result.enabled).toEqual([])
  })

  it('auto-enables the transitive requirement closure', () => {
    const result = resolveEnabledFeatures(
      [
        manifest({ id: 'leaf', enabledByDefault: false }),
        manifest({ id: 'mid', requires: ['leaf'], enabledByDefault: false }),
        manifest({ id: 'top', requires: ['mid'], enabledByDefault: true }),
      ],
      { platform: 'android' },
    )
    expect(new Set(result.enabled)).toEqual(new Set(['leaf', 'mid', 'top']))
    expect(result.enabled.indexOf('leaf')).toBeLessThan(result.enabled.indexOf('top'))
  })

  it('reports downstream modules blocked by a forced-off requirement instead of silently enabling it', () => {
    const result = resolveEnabledFeatures(
      [manifest({ id: 'core' }), manifest({ id: 'dependent', requires: ['core'] })],
      { platform: 'android', overrides: { core: false } },
    )
    expect(result.enabled).not.toContain('core')
    expect(result.enabled).not.toContain('dependent')
    expect(result.blocked).toEqual([{ feature: 'dependent', missingRequirement: 'core' }])
  })

  it('honors an explicit enable override for an off-by-default module', () => {
    const result = resolveEnabledFeatures([manifest({ id: 'opt-in', enabledByDefault: false })], {
      platform: 'android',
      overrides: { 'opt-in': true },
    })
    expect(result.enabled).toEqual(['opt-in'])
  })
})
