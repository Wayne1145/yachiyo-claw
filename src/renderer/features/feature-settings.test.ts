/** @vitest-environment jsdom */
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { SettingsSchema } from '@shared/types'
import * as defaults from '@shared/defaults'
import { createFeatureLocalStore, readFeatureSettings } from './feature-settings'

const spec = {
  featureId: 'sample',
  schema: z.object({ count: z.number().int().nonnegative() }),
  defaults: { count: 3 },
}

describe('feature settings', () => {
  it('survives the central Settings schema instead of being stripped by zod', () => {
    const parsed = SettingsSchema.parse({
      ...defaults.settings(),
      featureOverrides: { sample: false },
      featureSettings: { sample: { count: 4 } },
    })
    expect(parsed.featureOverrides).toEqual({ sample: false })
    expect(parsed.featureSettings).toEqual({ sample: { count: 4 } })
  })

  it('isolates namespaces and falls back when persisted data is invalid', () => {
    expect(readFeatureSettings(spec, { sample: { count: 8 }, other: { count: 99 } })).toEqual({ count: 8 })
    expect(readFeatureSettings(spec, { sample: { count: -1 } })).toEqual({ count: 3 })
  })

  it('uses the canonical local feature key format', () => {
    const store = createFeatureLocalStore('sample')
    expect(store.has('cache', 2)).toBe(false)
    store.set('cache', { ready: true }, 2)
    expect(store.has('cache', 2)).toBe(true)
    expect(localStorage.getItem('yachiyo:sample:cache:v2')).toBe('{"ready":true}')
    expect(store.get('cache', { ready: false }, 2)).toEqual({ ready: true })
  })
})
