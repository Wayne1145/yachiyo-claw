import { onAndroidDeviceOperation } from '@/packages/model-calls/toolsets/android-device'
import platform from '@/platform'
import { resetSemanticObservationCache, yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'
import type { AgentRunContext, FeatureLifecycle } from './lifecycle-contract'
import { hasFeatureLifecycle, registerFeatureLifecycle } from './lifecycle-runner'
import { getDesiredFeatureIds } from './feature-runtime'
import { runNativeFeatureSelfCheck } from './native-health'

export interface SandboxRunState {
  enabled: boolean
  unavailableReason: string
}

interface DeviceOverlayRunState {
  visible: boolean
  startPromise?: Promise<void>
}

const deviceOverlayRuns = new Map<string, DeviceOverlayRunState>()

function featureOption(context: AgentRunContext, featureId: string): Record<string, unknown> {
  return (context.featureOptions[featureId] as Record<string, unknown> | undefined) ?? {}
}

const deviceLifecycle: FeatureLifecycle = {
  featureId: 'android-device',
  onAgentRunStart(context) {
    if (!featureOption(context, 'android-device').enabled) return
    resetSemanticObservationCache(context.agentRunId)
    const overlay: DeviceOverlayRunState = { visible: false }
    deviceOverlayRuns.set(context.agentRunId, overlay)
    let stopListener: Awaited<ReturnType<typeof yachiyoDeviceAccessNative.onOverlayStopRequested>> | undefined

    const removeOperationListener = onAndroidDeviceOperation(async () => {
      if (overlay.visible) return overlay.startPromise
      overlay.visible = true
      overlay.startPromise = (async () => {
        stopListener = await yachiyoDeviceAccessNative.onOverlayStopRequested(context.requestAbort)
        await yachiyoDeviceAccessNative.showOperationOverlay('').catch(() => undefined)
      })()
      await overlay.startPromise
    })

    return async () => {
      removeOperationListener()
      await overlay.startPromise?.catch(() => undefined)
      await stopListener?.remove().catch(() => undefined)
      if (overlay.visible) await yachiyoDeviceAccessNative.hideOperationOverlay().catch(() => undefined)
      deviceOverlayRuns.delete(context.agentRunId)
      resetSemanticObservationCache(context.agentRunId)
    }
  },
}

const sandboxLifecycle: FeatureLifecycle = {
  featureId: 'sandbox',
  async onAgentRunStart(context) {
    const workingDirectory = featureOption(context, 'sandbox').workingDirectory
    const state: SandboxRunState = { enabled: true, unavailableReason: '' }
    if (typeof workingDirectory === 'string' && workingDirectory && platform.sandboxInit) {
      try {
        const status = platform.type === 'mobile' ? await platform.sandboxStatus?.() : undefined
        if (status && status.state !== 'ready') {
          state.enabled = false
          state.unavailableReason = `sandbox_${status.state}`
        } else {
          const initialized = await platform.sandboxInit({ workingDirectory })
          if (!initialized.success) {
            state.enabled = false
            state.unavailableReason = initialized.error || 'sandbox_initialization_failed'
          }
        }
      } catch (error) {
        state.enabled = false
        state.unavailableReason = error instanceof Error ? error.message : 'sandbox_initialization_failed'
      }
    }
    context.setFeatureState('sandbox', state)
  },
}

const coreLifecycle: FeatureLifecycle = {
  featureId: 'core-agent',
  onAppResume() {
    runNativeFeatureSelfCheck(getDesiredFeatureIds())
  },
}

const BUILTIN_LIFECYCLES = [coreLifecycle, deviceLifecycle, sandboxLifecycle] as const

export function registerBuiltinFeatureLifecycles(): void {
  for (const lifecycle of BUILTIN_LIFECYCLES) {
    if (!hasFeatureLifecycle(lifecycle.featureId)) registerFeatureLifecycle(lifecycle)
  }
}

export async function updateDeviceOperationOverlay(agentRunId: string, text: string): Promise<boolean> {
  const overlay = deviceOverlayRuns.get(agentRunId)
  if (!overlay?.visible) return false
  await overlay.startPromise?.catch(() => undefined)
  await yachiyoDeviceAccessNative.updateOperationOverlay(text).catch(() => undefined)
  return true
}

export function isDeviceOperationOverlayVisible(agentRunId: string): boolean {
  return deviceOverlayRuns.get(agentRunId)?.visible ?? false
}
