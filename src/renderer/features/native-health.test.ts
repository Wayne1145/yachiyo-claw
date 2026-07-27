import type { FeatureManifest } from '@shared/features/contract'
import { describe, expect, it } from 'vitest'
import { checkFeatureNativeBridges } from './native-health'

const manifests: FeatureManifest[] = [
  {
    id: 'native',
    displayName: 'Native',
    description: 'Native',
    platforms: ['android'],
    trust: 'inert',
    enabledByDefault: true,
    nativePlugins: ['Present', 'Missing'],
    androidPermissions: ['android.permission.CAMERA'],
  },
]

describe('native feature self-check', () => {
  it('reports missing enabled Android bridge plugins', () => {
    expect(checkFeatureNativeBridges(manifests, new Set(['native']), true, (name) => name === 'Present')).toEqual([
      {
        featureId: 'native',
        available: false,
        missingPlugins: ['Missing'],
        declaredPermissions: ['android.permission.CAMERA'],
      },
    ])
  })

  it('does not report disabled modules or fail browser builds', () => {
    expect(checkFeatureNativeBridges(manifests, new Set(), true, () => false)).toEqual([])
    expect(checkFeatureNativeBridges(manifests, new Set(['native']), false, () => false)[0]?.available).toBe(true)
  })
})
