import type { FeatureManifest } from '@shared/features/contract'
import { registerFeature, resetFeatureRegistry } from '@shared/features/registry'
import { IconCircle } from '@tabler/icons-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findFeatureTabForPath,
  getEnabledTabs,
  getSettingsEntries,
  registerFeatureUi,
  resetFeatureUiRegistry,
} from './ui-registry'

function manifest(id: string, platforms: FeatureManifest['platforms'] = ['android']): FeatureManifest {
  return { id, displayName: id, description: id, platforms, trust: 'inert', enabledByDefault: true }
}

afterEach(() => {
  resetFeatureUiRegistry()
  resetFeatureRegistry()
})

describe('feature UI registry', () => {
  it('sorts and filters tabs and settings by platform and override', () => {
    registerFeature(manifest('one'))
    registerFeature(manifest('desktop-only', ['desktop']))
    registerFeatureUi({
      featureId: 'one',
      tab: { id: 'one', label: 'One', icon: IconCircle, route: '/one', order: 20 },
      settingsEntries: [
        { group: 'app', label: 'One', detail: '', icon: IconCircle, route: '/settings/one', order: 10 },
      ],
    })
    registerFeatureUi({
      featureId: 'desktop-only',
      tab: { id: 'desktop-only', label: 'Desktop', icon: IconCircle, route: '/desktop', order: 1 },
    })
    expect(getEnabledTabs({ platform: 'android' }).map((tab) => tab.id)).toEqual(['one'])
    expect(findFeatureTabForPath('/one', { platform: 'android' })?.id).toBe('one')
    expect(getSettingsEntries('app', { platform: 'android' })).toHaveLength(1)
    expect(getEnabledTabs({ platform: 'android', overrides: { one: false } })).toEqual([])
  })

  it('caps Android navigation at five visible tabs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (let index = 0; index < 6; index += 1) {
      const id = `tab-${index}`
      registerFeature(manifest(id))
      registerFeatureUi({ featureId: id, tab: { id, label: id, icon: IconCircle, route: `/${id}`, order: index } })
    }
    expect(getEnabledTabs({ platform: 'android' })).toHaveLength(5)
    expect(warn).toHaveBeenCalledOnce()
  })
})
