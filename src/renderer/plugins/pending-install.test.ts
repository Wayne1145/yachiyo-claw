// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))

import {
  clearPendingPluginInstall,
  markPendingPluginInstallEnqueued,
  readPendingPluginInstall,
  savePendingPluginInstall,
} from './pending-install'

const pending = {
  schemaVersion: 1 as const,
  state: 'prepared' as const,
  request: {
    id: `plugin-${'a'.repeat(32)}`,
    kind: 'plugin' as const,
    title: 'Demo plugin',
    url: 'https://example.com/plugin.zip',
    expectedSize: 1024,
  },
  source: 'https' as const,
  createdAt: Date.now(),
}

describe('pending plugin install state', () => {
  beforeEach(() => localStorage.clear())

  it('persists the prepared-to-enqueued transition and clears only the matching task', () => {
    savePendingPluginInstall(pending)
    expect(readPendingPluginInstall()).toMatchObject({ state: 'prepared', request: { id: pending.request.id } })

    markPendingPluginInstallEnqueued(pending.request.id)
    expect(readPendingPluginInstall()).toMatchObject({ state: 'enqueued' })

    clearPendingPluginInstall(`plugin-${'b'.repeat(32)}`)
    expect(readPendingPluginInstall()).not.toBeNull()
    clearPendingPluginInstall(pending.request.id)
    expect(readPendingPluginInstall()).toBeNull()
  })

  it('drops malformed or expired state instead of trusting it', () => {
    localStorage.setItem('yachiyo:plugins:pending-download:v1', JSON.stringify({ ...pending, createdAt: 1 }))
    expect(readPendingPluginInstall()).toBeNull()
    localStorage.setItem(
      'yachiyo:plugins:pending-download:v1',
      JSON.stringify({ ...pending, request: { ...pending.request, id: '../../escape' } }),
    )
    expect(readPendingPluginInstall()).toBeNull()
  })
})
