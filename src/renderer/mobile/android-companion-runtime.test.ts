import { afterEach, describe, expect, it } from 'vitest'
import { getAndroidCompanionRegistry } from './agent-broker'
import { clearAndroidCompanions, configureAndroidCompanions } from './android-companion-runtime'

describe('Android companion runtime', () => {
  afterEach(() => clearAndroidCompanions())

  it('registers explicit endpoints with the Agent Broker without probing the network', async () => {
    const registry = await configureAndroidCompanions({
      includeStoredMobileMcp: false,
      explicitEndpoints: [
        {
          id: 'local-companion',
          protocol: 'yachiyo-http',
          url: 'http://127.0.0.1:8787/control',
          bearerToken: 'runtime-token',
        },
      ],
    })

    expect(registry.list().map((adapter) => adapter.id)).toEqual(['local-companion'])
    expect(getAndroidCompanionRegistry()).toBe(registry)
  })
})
