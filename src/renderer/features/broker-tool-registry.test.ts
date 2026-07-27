import { beforeEach, describe, expect, it } from 'vitest'
import { TOOL_IDS } from '@shared/agent'
import {
  registerBrokerToolDescriptor,
  registerBuiltInBrokerTools,
  registerCompanionBrokerTool,
  requireBrokerToolAuthorization,
  resetBrokerToolRegistry,
} from './broker-tool-registry'

describe('Broker tool descriptor registry', () => {
  beforeEach(resetBrokerToolRegistry)

  it('authorizes built-ins only for their owning feature and backend', () => {
    registerBuiltInBrokerTools()
    expect(
      requireBrokerToolAuthorization({ featureId: 'android-device', toolId: TOOL_IDS.UI_TAP, backend: 'accessibility' }),
    ).toMatchObject({ riskLevel: 'act' })
    expect(() =>
      requireBrokerToolAuthorization({ featureId: 'sandbox', toolId: TOOL_IDS.UI_TAP, backend: 'accessibility' }),
    ).toThrow('broker_tool_feature_mismatch')
    expect(() =>
      requireBrokerToolAuthorization({ featureId: 'android-device', toolId: TOOL_IDS.SHELL_EXEC, backend: 'accessibility' }),
    ).toThrow('broker_tool_backend_denied')
  })

  it('rejects a non-privileged feature registering a privileged id', () => {
    expect(() =>
      registerBrokerToolDescriptor({
        featureId: 'malicious',
        trust: 'sandboxed',
        descriptor: {
          schemaVersion: 1,
          toolId: TOOL_IDS.SHELL_EXEC,
          version: 1,
          displayName: 'bad',
          description: 'Attempts to claim shell.',
          parametersSchema: {},
          resultSchema: {},
          modelResultPolicy: { sensitivity: 'private', maxBytes: 1024, retention: 'task' },
          riskLevel: 'destructive',
          approvalPolicy: { mode: 'blocked', reason: 'not allowed' },
          supportedBackends: ['root'],
        },
      }),
    ).toThrow('broker_tool_privilege_escalation')
  })

  it('registers a companion capability explicitly before dispatch', () => {
    registerCompanionBrokerTool('android.companion.device.open')
    expect(
      requireBrokerToolAuthorization({
        featureId: 'android-device',
        toolId: 'android.companion.device.open',
        backend: 'companion',
      }),
    ).toMatchObject({ supportedBackends: ['companion'] })
  })
})
