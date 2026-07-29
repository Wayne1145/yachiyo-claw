import type { AgentPrincipal, JsonValue } from '@shared/agent'
import type { PluginGrant } from '@shared/plugins/grants'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsStore } from '@/stores/settingsStore'
import type { InstalledPluginRecord } from './installer'
import type { HostApi, HostCallAuthorizer, PluginHostCallContext, PluginRuntimeOptions } from './plugin-runtime'
import type { AgentApprovalAuthorization } from '@/mobile/agent-approval'

const SHA = 'a'.repeat(64)

const mocks = vi.hoisted(() => ({
  currentRecord: null as unknown,
  rollbackRecord: null as unknown,
  grants: new Map<string, PluginGrant>(),
  health: new Map<string, import('@shared/plugins/lifecycle').PluginHealth>(),
  runtimeOptions: null as unknown,
  runtimeDisposed: false,
  runtimeLoad: vi.fn(async () => [] as Array<{ name: string }>),
  runtimeCreate: vi.fn(),
  toolsetSources: null as unknown,
  runtimeDispose: vi.fn(),
  installerInspect: vi.fn(),
  installerInstall: vi.fn(),
  grantPutFailureCapability: null as string | null,
  registryPut: vi.fn(),
  auditEntries: [] as unknown[],
  executionRequests: [] as unknown[],
  sessionConfig: {
    enabled: true,
    deviceControlEnabled: true,
    allowDangerousForConversation: true,
  },
  fullAccess: true,
  approval: vi.fn<() => Promise<AgentApprovalAuthorization>>(async () => ({
    decision: 'once',
    approvalNonce: 'nonce',
    expiresAt: Date.now() + 30_000,
  })),
  cancelPluginApprovals: vi.fn(),
  startPluginJob: vi.fn(async () => ({ accepted: true, jobId: 'job-1' })),
  queryJob: vi.fn(async () => ({ state: 'succeeded', exitCode: 0 })),
  readJobOutput: vi.fn(async () => ({ stdout: 'ok', stderr: '', stdoutOffset: 2, stderrOffset: 0 })),
  stopJob: vi.fn(async () => ({ success: true })),
  readPluginFile: vi.fn(async () => ({ success: true, content: 'file-content' })),
  writePluginFile: vi.fn(async () => ({ success: true })),
  cleanupPlugin: vi.fn(async () => ({ success: true, stoppedJobs: 1, removedWorkspace: true })),
  accessibilityAction: vi.fn(async () => ({ success: true })),
  launchAppBound: vi.fn(async () => ({ success: true })),
  networkFetch: vi.fn(async () => ({ status: 200, contentType: 'application/json', body: '{}', truncated: false, finalUrl: 'https://api.example.com/' })),
  networkCancel: vi.fn(async () => undefined),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@/platform', () => ({ default: { getVersion: async () => '0.0.11' } }))
vi.mock('@/mobile/agent-session-config', () => ({ getAgentSessionConfig: () => mocks.sessionConfig }))
vi.mock('@/mobile/agent-approval', () => ({
  requestAgentAuthorization: mocks.approval,
  cancelPendingPluginApprovals: mocks.cancelPluginApprovals,
}))
vi.mock('@/mobile/agent-broker', () => ({
  appendAgentAudit: (entry: unknown) => mocks.auditEntries.push(entry),
  digestAgentJson: async () => 'd'.repeat(64),
  isAgentFullAccessEnabled: () => mocks.fullAccess,
  executeAgentAction: async (request: {
    abortSignal?: AbortSignal
    execute: () => Promise<unknown> | unknown
    onAbort?: () => Promise<void> | void
  }) => {
    mocks.executionRequests.push(request)
    try {
      if (request.abortSignal?.aborted) throw new Error('cancelled')
      return await request.execute()
    } catch (error) {
      if (request.abortSignal?.aborted) await request.onAbort?.()
      throw error
    }
  },
}))
vi.mock('@/platform/native/yachiyo_device_access', () => ({
  yachiyoDeviceAccessNative: {
    accessibilityAction: mocks.accessibilityAction,
    launchAppBound: mocks.launchAppBound,
  },
}))
vi.mock('@/platform/native/yachiyo_plugin_network', () => ({
  yachiyoPluginNetworkNative: { fetch: mocks.networkFetch, cancel: mocks.networkCancel },
}))
vi.mock('@/platform/native/yachiyo_sandbox', () => ({
  yachiyoSandboxNative: {
    startPluginJob: mocks.startPluginJob,
    queryJob: mocks.queryJob,
    readJobOutput: mocks.readJobOutput,
    stopJob: mocks.stopJob,
    readPluginFile: mocks.readPluginFile,
    writePluginFile: mocks.writePluginFile,
    cleanupPlugin: mocks.cleanupPlugin,
  },
}))
vi.mock('./plugin-toolset', () => ({
  initPluginToolset: (sources: unknown) => {
    mocks.toolsetSources = sources
  },
}))
vi.mock('./blob-worker-runtime', () => ({
  createBlobWorkerRuntime: (options: unknown) => {
    mocks.runtimeCreate(options)
    mocks.runtimeOptions = options
    mocks.runtimeDisposed = false
    return {
      load: mocks.runtimeLoad,
      getRegisteredTools: () => [],
      isDisposed: () => mocks.runtimeDisposed,
      dispose: () => {
        mocks.runtimeDisposed = true
        mocks.runtimeDispose()
      },
    }
  },
}))
vi.mock('./installer', () => ({
  assertPluginUpdateProvenance: vi.fn(),
  PluginInstaller: class {
    inspect = mocks.installerInspect
    install = mocks.installerInstall
    uninstall = vi.fn(async () => undefined)
    rollback = vi.fn(async () => mocks.rollbackRecord ?? mocks.currentRecord)
    restoreAfterFailedUpdate = vi.fn(async () => undefined)
    cleanupAbandonedCode = vi.fn(async () => undefined)
  },
  pluginInstallDir: (record: { installDir?: string; manifest: { id: string } }) =>
    record.installDir ?? `yachiyo-plugins/${record.manifest.id}`,
}))
vi.mock('./capacitor-stores', () => ({
  capacitorPluginFileStore: { readFile: vi.fn(async () => new TextEncoder().encode('entry')) },
  listInstalledPlugins: async () => (mocks.currentRecord ? [mocks.currentRecord] : []),
  localforagePluginRegistry: {
    get: async (pluginId: string) => {
      const record = mocks.currentRecord as InstalledPluginRecord | null
      return record?.manifest.id === pluginId ? record : null
    },
    put: mocks.registryPut,
  },
  pluginGrantStore: {
    get: async (pluginId: string, capability: string) => mocks.grants.get(`${pluginId}:${capability}`) ?? null,
    put: async (grant: PluginGrant) => {
      if (mocks.grantPutFailureCapability === grant.capability) throw new Error('grant_write_failed')
      mocks.grants.set(`${grant.pluginId}:${grant.capability}`, structuredClone(grant))
    },
    remove: async (pluginId: string, capability: string) => mocks.grants.delete(`${pluginId}:${capability}`),
    removeAll: async (pluginId: string) => {
      for (const key of [...mocks.grants.keys()]) if (key.startsWith(`${pluginId}:`)) mocks.grants.delete(key)
    },
  },
  pluginDataStore: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    removeAll: vi.fn(async () => undefined),
    keys: vi.fn(async () => []),
    usedBytes: vi.fn(async () => 0),
  },
  pluginHealthStore: {
    get: vi.fn(async (pluginId: string) => mocks.health.get(pluginId) ?? null),
    put: vi.fn(async (pluginId: string, health: import('@shared/plugins/lifecycle').PluginHealth) => {
      mocks.health.set(pluginId, structuredClone(health))
    }),
    remove: vi.fn(async (pluginId: string) => mocks.health.delete(pluginId)),
  },
}))

import {
  disposeAllPluginRuntimes,
  disposePluginRuntime,
  initPluginTools,
  invokeLoadedPluginTool,
  loadPluginForPage,
  readPluginAudit,
  setPluginGrant,
  usePluginStore,
} from './plugin-manager'

function makeRecord(
  id: string,
  options: { trusted?: boolean; capabilities?: PluginGrant['capability'][] } = {}
): InstalledPluginRecord {
  const capabilities = options.capabilities ?? ['storage', 'sandbox', 'device']
  return {
    manifest: {
      schemaVersion: 1,
      id,
      version: '1.0.0',
      displayName: 'Security Test Plugin',
      description: 'Exercises plugin host security boundaries.',
      entry: 'main.js',
      capabilities: capabilities.map((name) => ({
        name,
        reason: `Needs ${name} for this security test.`,
        ...(name === 'network' ? { domains: ['api.example.com'] } : {}),
      })),
      contributions: {},
      files: [{ path: 'main.js', size: 5, sha256: SHA }],
    },
    packageSha256: SHA,
    signatureVerified: options.trusted ?? true,
    deviceGrantAllowed: options.trusted ?? true,
    signerKeyId: options.trusted === false ? undefined : 'trusted-key',
    source: 'https',
    installedAt: 1,
    installDir: `yachiyo-plugins/${id}`,
  } as InstalledPluginRecord
}

function grant(
  record: InstalledPluginRecord,
  capability: PluginGrant['capability'],
  state: PluginGrant['state'] = 'granted'
) {
  mocks.grants.set(`${record.manifest.id}:${capability}`, {
    schemaVersion: 1,
    pluginId: record.manifest.id,
    capability,
    state,
    boundEntrySha256: record.manifest.entrySha256 ?? record.packageSha256,
    decidedAt: 1,
    expiresAt: null,
    ...(capability === 'network' ? { domains: ['api.example.com'] } : {}),
  })
}

async function loadBoundary(record: InstalledPluginRecord): Promise<{
  hostApi: HostApi
  authorize: HostCallAuthorizer
  context: PluginHostCallContext
}> {
  mocks.currentRecord = record
  await loadPluginForPage(record.manifest.id)
  const options = mocks.runtimeOptions as PluginRuntimeOptions
  const principal: AgentPrincipal = {
    kind: 'plugin',
    pluginId: record.manifest.id,
    entrySha256: record.manifest.entrySha256 ?? record.packageSha256,
  }
  return {
    hostApi: options.hostApi,
    authorize: options.authorize,
    context: {
      principal,
      sessionId: `session-${record.manifest.id}`,
      runId: `run-${record.manifest.id}`,
      toolCallId: `call-${record.manifest.id}`,
      hostCallId: 'h0',
      signal: new AbortController().signal,
    },
  }
}

describe('plugin manager security integration', () => {
  beforeEach(() => {
    mocks.currentRecord = null
    mocks.rollbackRecord = null
    mocks.grants.clear()
    mocks.health.clear()
    mocks.runtimeOptions = null
    mocks.runtimeDisposed = false
    mocks.runtimeLoad.mockClear()
    mocks.runtimeCreate.mockClear()
    mocks.runtimeDispose.mockClear()
    mocks.installerInspect.mockReset()
    mocks.installerInstall.mockReset()
    mocks.grantPutFailureCapability = null
    mocks.registryPut.mockReset()
    mocks.auditEntries.length = 0
    mocks.executionRequests.length = 0
    mocks.fullAccess = true
    mocks.sessionConfig = {
      enabled: true,
      deviceControlEnabled: true,
      allowDangerousForConversation: true,
    }
    mocks.approval.mockClear()
    mocks.cancelPluginApprovals.mockClear()
    mocks.startPluginJob.mockClear()
    mocks.queryJob.mockReset().mockResolvedValue({ state: 'succeeded', exitCode: 0 })
    mocks.readJobOutput.mockReset().mockResolvedValue({ stdout: 'ok', stderr: '', stdoutOffset: 2, stderrOffset: 0 })
    mocks.stopJob.mockClear()
    mocks.readPluginFile.mockClear()
    mocks.writePluginFile.mockClear()
    mocks.cleanupPlugin.mockClear()
    mocks.accessibilityAction.mockClear()
    mocks.launchAppBound.mockClear()
    mocks.networkFetch.mockClear()
    mocks.networkCancel.mockClear()
    usePluginStore.setState({ installed: [], pendingConsent: null })
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })

  it('always records device as denied during installation, even for a signed package', async () => {
    const record = makeRecord('install-security', { capabilities: ['storage', 'device'], trusted: true })
    mocks.currentRecord = record
    mocks.installerInstall.mockResolvedValue(record)
    usePluginStore.setState({
      pendingConsent: {
        verified: {
          manifest: record.manifest,
          files: new Map(),
          packageSha256: record.packageSha256,
          signatureVerified: true,
          deviceGrantAllowed: true,
          signerKeyId: record.signerKeyId,
          source: 'https',
          unpackedBytes: 5,
        },
        bytes: new Uint8Array([1]),
        preservedCapabilities: [],
      },
    })

    await usePluginStore.getState().confirmInstall(['storage', 'device'])

    expect(mocks.grants.get('install-security:storage')?.state).toBe('granted')
    expect(mocks.grants.get('install-security:device')?.state).toBe('denied')
  })

  it('restores only the previous manifest grants when update authorization persistence fails', async () => {
    const previous = makeRecord('grant-compensation', { capabilities: ['storage'] })
    const updated = makeRecord('grant-compensation', { capabilities: ['storage', 'network'] })
    updated.manifest.version = '1.1.0'
    updated.packageSha256 = 'b'.repeat(64)
    mocks.currentRecord = previous
    mocks.installerInstall.mockResolvedValue(updated)
    grant(previous, 'storage')
    mocks.grantPutFailureCapability = 'network'
    usePluginStore.setState({
      pendingConsent: {
        verified: {
          manifest: updated.manifest,
          files: new Map(),
          packageSha256: updated.packageSha256,
          signatureVerified: true,
          deviceGrantAllowed: true,
          signerKeyId: updated.signerKeyId,
          source: 'https',
          unpackedBytes: 5,
        },
        bytes: new Uint8Array([1]),
        preservedCapabilities: ['storage'],
      },
    })

    await expect(usePluginStore.getState().confirmInstall(['storage', 'network'])).rejects.toThrow(
      'grant_write_failed',
    )

    expect(mocks.grants.has('grant-compensation:network')).toBe(false)
    expect(mocks.grants.get('grant-compensation:storage')).toMatchObject({
      state: 'granted',
      boundEntrySha256: previous.packageSha256,
    })
  })

  it('rejects an update package whose verified plugin identity does not match the selected plugin', async () => {
    const other = makeRecord('different-plugin', { capabilities: ['storage'] })
    mocks.installerInspect.mockResolvedValueOnce({
      manifest: other.manifest,
      files: new Map(),
      packageSha256: other.packageSha256,
      signatureVerified: true,
      deviceGrantAllowed: true,
      signerKeyId: other.signerKeyId,
      source: 'https',
      unpackedBytes: 5,
    })

    await expect(
      usePluginStore.getState().requestInstall(new Uint8Array([1]), 'https', {
        expectedPlugin: { id: 'selected-plugin' },
      }),
    ).rejects.toThrow('plugin_update_identity_mismatch')
    expect(usePluginStore.getState().pendingConsent).toBeNull()
  })

  it('removes grants that are not declared by a rolled-back version', async () => {
    const current = makeRecord('rollback-grants', { capabilities: ['storage', 'network'] })
    const target = makeRecord('rollback-grants', { capabilities: ['storage'] })
    target.manifest.version = '0.9.0'
    target.packageSha256 = 'b'.repeat(64)
    mocks.currentRecord = current
    mocks.rollbackRecord = target
    grant(current, 'storage')
    grant(current, 'network')

    await usePluginStore.getState().rollback(current.manifest.id)

    expect(mocks.grants.has('rollback-grants:network')).toBe(false)
    expect(mocks.grants.get('rollback-grants:storage')).toMatchObject({
      state: 'revoked',
      boundEntrySha256: target.packageSha256,
    })
  })

  it('does not boot or invoke a plugin while the global feature is disabled', async () => {
    const previous = settingsStore.getState().featureOverrides
    const record = makeRecord('globally-disabled', { capabilities: ['storage'] })
    mocks.currentRecord = record
    settingsStore.setState({ featureOverrides: { ...previous, plugins: false } })
    try {
      await expect(loadPluginForPage(record.manifest.id)).rejects.toThrow('plugin_feature_disabled')
      expect(mocks.runtimeCreate).not.toHaveBeenCalled()
    } finally {
      settingsStore.setState({ featureOverrides: previous })
    }
  })

  it('loads a page preview without booting its worker runtime', async () => {
    const record = makeRecord('deferred-page-runtime', { capabilities: ['storage'] })
    mocks.currentRecord = record

    const loaded = await loadPluginForPage(record.manifest.id, { startRuntime: false })

    expect(loaded).toMatchObject({ runtime: null, tools: [] })
    expect(mocks.runtimeCreate).not.toHaveBeenCalled()
  })

  it('records lifecycle cancellation without counting it as a plugin failure', async () => {
    const runtime = {
      invokeTool: vi.fn(async () => {
        throw new Error('cancelled')
      }),
      isDisposed: () => true,
    }

    await expect(invokeLoadedPluginTool('cancelled-page', runtime as never, 'render', {})).rejects.toThrow(
      'cancelled'
    )

    expect(mocks.health.has('cancelled-page')).toBe(false)
    expect(readPluginAudit('cancelled-page')).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: 'invocation_cancelled', status: 'cancelled' })])
    )
  })

  it('terminates every live runtime when the global plugin feature is switched off', async () => {
    const previous = settingsStore.getState().featureOverrides
    const record = makeRecord('runtime-to-stop', { capabilities: ['storage'] })
    mocks.currentRecord = record
    const loaded = await loadPluginForPage(record.manifest.id)
    expect(loaded?.runtime).toBeTruthy()

    settingsStore.setState({ featureOverrides: { ...previous, plugins: false } })
    try {
      disposeAllPluginRuntimes()
      expect(mocks.runtimeDispose).toHaveBeenCalled()
      await expect(
        invokeLoadedPluginTool(record.manifest.id, loaded?.runtime as never, 'runtime-to-stop_tool', {})
      ).rejects.toThrow('plugin_feature_disabled')
      expect(readPluginAudit(record.manifest.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'invocation_denied', reason: 'plugin_feature_disabled' }),
          expect.objectContaining({ event: 'runtime_stopped', reason: 'plugin_feature_disabled' }),
        ])
      )
    } finally {
      settingsStore.setState({ featureOverrides: previous })
    }
  })

  it('refuses to enable device for an unsigned package and terminates a runtime on revocation', async () => {
    const unsigned = makeRecord('unsigned-device', { capabilities: ['device'], trusted: false })
    await setPluginGrant(unsigned, 'device', true)
    expect(mocks.grants.has('unsigned-device:device')).toBe(false)

    const loaded = makeRecord('revoke-sandbox', { capabilities: ['sandbox'] })
    grant(loaded, 'sandbox')
    await loadBoundary(loaded)
    await setPluginGrant(loaded, 'sandbox', false)
    expect(mocks.grants.get('revoke-sandbox:sandbox')?.state).toBe('revoked')
    expect(mocks.runtimeDispose).toHaveBeenCalledOnce()
    disposePluginRuntime(loaded.manifest.id)
  })

  it('rejects core, wrong-plugin, and wrong-digest principals before reading grants', async () => {
    const record = makeRecord('principal-check', { capabilities: ['sandbox'] })
    grant(record, 'sandbox')
    const boundary = await loadBoundary(record)
    const contexts = [
      { ...boundary.context, principal: { kind: 'core' as const } },
      {
        ...boundary.context,
        principal: { kind: 'plugin' as const, pluginId: 'other', entrySha256: SHA },
      },
      {
        ...boundary.context,
        principal: { kind: 'plugin' as const, pluginId: record.manifest.id, entrySha256: 'b'.repeat(64) },
      },
    ]

    for (const context of contexts) {
      await expect(boundary.authorize('sandbox.readFile', { path: 'data.txt' }, context)).resolves.toEqual({
        allowed: false,
        reason: 'plugin_principal_mismatch',
      })
    }
    await expect(boundary.authorize('sandbox.readFile', { path: 'data.txt' }, boundary.context)).resolves.toEqual({
      allowed: true,
    })
  })

  it('does not let a conversation device allowance replace the plugin device grant', async () => {
    const record = makeRecord('device-grant-check', { capabilities: ['device'] })
    grant(record, 'device', 'denied')
    const boundary = await loadBoundary(record)

    await expect(boundary.authorize('device.observe', {}, boundary.context)).resolves.toEqual({
      allowed: false,
      reason: 'capability_denied:not_granted',
    })
    expect(mocks.sessionConfig.allowDangerousForConversation).toBe(true)
    expect(mocks.accessibilityAction).not.toHaveBeenCalled()
  })

  it('rejects a stored grant for a capability the current manifest no longer declares', async () => {
    const record = makeRecord('manifest-bound', { capabilities: ['storage'] })
    grant(record, 'network')
    const boundary = await loadBoundary(record)

    await expect(boundary.authorize('network.fetch', { url: 'https://api.example.com/' }, boundary.context)).resolves.toEqual({
      allowed: false,
      reason: 'capability_not_declared',
    })
  })

  it('requires explicit approval for mutating network requests regardless of tool risk metadata', async () => {
    const record = makeRecord('network-approval', { capabilities: ['network'] })
    grant(record, 'network')
    const boundary = await loadBoundary(record)
    mocks.approval.mockResolvedValueOnce({ decision: 'deny' })

    await expect(
      boundary.hostApi['network.fetch'](
        { url: 'https://api.example.com/follow', method: 'POST', body: '{}' },
        boundary.context,
      ),
    ).rejects.toThrow('plugin_network_user_denied')
    expect(mocks.networkFetch).not.toHaveBeenCalled()

    mocks.approval.mockResolvedValueOnce({ decision: 'once' })
    await expect(
      boundary.hostApi['network.fetch'](
        { url: 'https://api.example.com/follow', method: 'POST', body: '{}' },
        boundary.context,
      ),
    ).resolves.toMatchObject({ status: 200 })
    expect(mocks.approval).toHaveBeenLastCalledWith(
      expect.objectContaining({ risk: 'dangerous', bindingDigest: 'd'.repeat(64) }),
    )
    expect(mocks.networkFetch).toHaveBeenCalledOnce()
    expect(mocks.executionRequests.at(-1)).toEqual(
      expect.objectContaining({
        principal: boundary.context.principal,
        toolId: 'plugin.network.fetch',
        backend: 'standard',
        sideEffect: true,
        approvalDecision: 'once',
        parameters: expect.objectContaining({
          url: 'https://api.example.com/follow',
          method: 'POST',
          bodyBytes: 2,
          bodyDigest: 'd'.repeat(64),
        }),
      }),
    )
    expect(mocks.auditEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: 'plugin.network.fetch',
          backend: 'standard',
          approvalDecision: 'deny',
          status: 'denied',
        }),
      ]),
    )
  })

  it('rejects every sandbox and device host call without an Agent session', async () => {
    const record = makeRecord('session-bound', { capabilities: ['sandbox', 'device'] })
    grant(record, 'sandbox')
    grant(record, 'device')
    const boundary = await loadBoundary(record)
    const context = { ...boundary.context, sessionId: undefined }

    await expect(boundary.authorize('sandbox.readFile', { path: 'data.txt' }, context)).resolves.toEqual({
      allowed: false,
      reason: 'sandbox_session_required',
    })
    await expect(boundary.authorize('device.observe', {}, context)).resolves.toEqual({
      allowed: false,
      reason: 'device_session_required',
    })
    expect(readPluginAudit(record.manifest.id, 20)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'capability_denied',
          method: 'sandbox.readFile',
          reason: 'sandbox_session_required',
        }),
      ])
    )
    await expect(boundary.hostApi['sandbox.readFile']({ path: 'data.txt' }, context)).rejects.toThrow(
      'sandbox_session_required'
    )
  })

  it('single-flights concurrent cold starts for the same plugin', async () => {
    const record = makeRecord('single-flight', { capabilities: ['storage'] })
    mocks.currentRecord = record
    let release: (tools: Array<{ name: string }>) => void = () => undefined
    mocks.runtimeLoad.mockImplementationOnce(
      () => new Promise<Array<{ name: string }>>((resolve) => (release = resolve))
    )

    const first = loadPluginForPage(record.manifest.id)
    const second = loadPluginForPage(record.manifest.id)
    await vi.waitFor(() => expect(mocks.runtimeCreate).toHaveBeenCalledOnce())
    release([])
    const [left, right] = await Promise.all([first, second])

    expect(left?.runtime).toBe(right?.runtime)
    expect(mocks.runtimeLoad).toHaveBeenCalledOnce()
    disposePluginRuntime(record.manifest.id)
  })

  it('applies the app-version gate to the Agent tool runtime path', async () => {
    const record = makeRecord('future-plugin', { capabilities: ['storage'] })
    record.manifest.minAppVersion = '99.0.0'
    mocks.currentRecord = record
    initPluginTools()
    const sources = mocks.toolsetSources as {
      listPlugins(): Promise<InstalledPluginRecord[]>
      runtime: {
        invoke(
          pluginId: string,
          toolName: string,
          args: JsonValue,
          timeoutMs: number,
          context: Record<string, unknown>
        ): Promise<JsonValue>
      }
    }

    await expect(sources.listPlugins()).resolves.toEqual([])
    await expect(sources.runtime.invoke(record.manifest.id, 'tool', {}, 1_000, {})).rejects.toThrow(
      'plugin_incompatible_app_version'
    )
    expect(mocks.runtimeCreate).not.toHaveBeenCalled()
  })

  it('terminates a live runtime as soon as its failure threshold auto-disables the plugin', async () => {
    const record = makeRecord('health-stop', { capabilities: ['storage'] })
    mocks.currentRecord = record
    const loaded = await loadPluginForPage(record.manifest.id)
    mocks.health.set(record.manifest.id, {
      consecutiveFailures: 2,
      totalFailures: 2,
      totalTimeouts: 0,
    })

    await expect(
      invokeLoadedPluginTool(record.manifest.id, loaded!.runtime!, 'missing', {}),
    ).rejects.toThrow()
    expect(mocks.health.get(record.manifest.id)?.disabledReason).toContain('自动禁用')
    expect(mocks.runtimeDispose).toHaveBeenCalled()
  })

  it('exposes only semantic device methods and rejects traversal-shaped sandbox paths', async () => {
    const record = makeRecord('host-whitelist')
    grant(record, 'sandbox')
    grant(record, 'device')
    const boundary = await loadBoundary(record)

    expect(
      Object.keys(boundary.hostApi)
        .filter((name) => name.startsWith('device.'))
        .sort()
    ).toEqual([
      'device.click',
      'device.find',
      'device.keyevent',
      'device.launch',
      'device.observe',
      'device.scroll',
      'device.setText',
    ])
    expect(boundary.hostApi['device.rawTap']).toBeUndefined()
    expect(boundary.hostApi['device.shell']).toBeUndefined()

    for (const path of ['../secret', '/absolute', 'a\\b', 'a//b', './relative']) {
      await expect(boundary.hostApi['sandbox.readFile']({ path }, boundary.context)).rejects.toThrow()
    }
    expect(mocks.readPluginFile).not.toHaveBeenCalled()
  })

  it('bounds sandbox output and stops the native job when the invocation is cancelled', async () => {
    const record = makeRecord('sandbox-output', { capabilities: ['sandbox'] })
    grant(record, 'sandbox')
    const boundary = await loadBoundary(record)
    mocks.readJobOutput.mockResolvedValueOnce({
      stdout: 'x'.repeat(300 * 1024),
      stderr: 'y'.repeat(300 * 1024),
      stdoutOffset: 300 * 1024,
      stderrOffset: 300 * 1024,
    })

    const bounded = (await boundary.hostApi['sandbox.exec']({ command: 'printf output' }, boundary.context)) as {
      stdout: string
      stderr: string
      exitCode: number
    }
    expect(new TextEncoder().encode(bounded.stdout).byteLength).toBeLessThan(257 * 1024)
    expect(new TextEncoder().encode(bounded.stderr).byteLength).toBeLessThan(257 * 1024)
    expect(bounded.stdout).toContain('[output truncated]')

    const controller = new AbortController()
    const cancelledContext = { ...boundary.context, signal: controller.signal }
    mocks.queryJob.mockImplementationOnce(async () => {
      controller.abort()
      throw new Error('native_cancelled')
    })
    await expect(boundary.hostApi['sandbox.exec']({ command: 'long-running-task' }, cancelledContext)).rejects.toThrow(
      'native_cancelled'
    )
    expect(mocks.stopJob).toHaveBeenCalled()
  })

  it('enforces the per-plugin sandbox execution quota', async () => {
    const record = makeRecord('sandbox-quota', { capabilities: ['sandbox'] })
    grant(record, 'sandbox')
    const boundary = await loadBoundary(record)

    for (let index = 0; index < 30; index++) {
      await expect(
        boundary.hostApi['sandbox.exec']({ command: `printf ${index}` }, boundary.context)
      ).resolves.toMatchObject({ exitCode: 0 })
    }
    await expect(boundary.hostApi['sandbox.exec']({ command: 'printf overflow' }, boundary.context)).rejects.toThrow(
      'plugin_sandbox_hourly_quota_exceeded'
    )
    expect(mocks.startPluginJob).toHaveBeenCalledTimes(30)
  })

  it('passes plugin principal and Broker metadata into every sandbox action', async () => {
    const record = makeRecord('sandbox-audit', { capabilities: ['sandbox'] })
    grant(record, 'sandbox')
    const boundary = await loadBoundary(record)
    await boundary.hostApi['sandbox.readFile']({ path: 'notes/data.txt' }, boundary.context)

    expect(mocks.executionRequests.at(-1)).toEqual(
      expect.objectContaining({
        principal: boundary.context.principal,
        toolId: 'plugin.sandbox.read',
        backend: 'sandbox',
        parameters: { path: 'notes/data.txt' },
        callId: `plugin-${'d'.repeat(64)}`,
        stepId: `plugin-${'d'.repeat(64)}`,
        toolCallId: `call-${record.manifest.id}`,
        sideEffect: false,
      })
    )
  })

  it('removes native sandbox jobs and workspace during uninstall', async () => {
    const record = makeRecord('cleanup-plugin', { capabilities: ['sandbox'] })
    mocks.currentRecord = record

    await usePluginStore.getState().uninstall(record.manifest.id)

    expect(mocks.cleanupPlugin).toHaveBeenCalledWith({ pluginId: record.manifest.id })
    expect(mocks.cancelPluginApprovals).toHaveBeenCalledWith(record.manifest.id)
  })
})
