import { getAllFeatures, resolveFeatureOrder } from '@shared/features/registry'
import type { AgentRunContext, AgentRunCleanup, FeatureLifecycle } from './lifecycle-contract'
import { setFeatureUnavailable } from './feature-runtime'

const lifecycles = new Map<string, FeatureLifecycle>()

export function registerFeatureLifecycle(lifecycle: FeatureLifecycle): void {
  if (lifecycles.has(lifecycle.featureId)) {
    throw new Error(`Feature lifecycle "${lifecycle.featureId}" is already registered.`)
  }
  lifecycles.set(lifecycle.featureId, lifecycle)
}

export function hasFeatureLifecycle(featureId: string): boolean {
  return lifecycles.has(featureId)
}

export function resetFeatureLifecycleRegistry(): void {
  lifecycles.clear()
}

function orderedLifecycles(enabledFeatureIds: ReadonlySet<string>): FeatureLifecycle[] {
  const manifests = getAllFeatures().filter((manifest) => enabledFeatureIds.has(manifest.id))
  const orderedIds = new Set(resolveFeatureOrder(manifests).map((manifest) => manifest.id))
  const ordered = Array.from(orderedIds)
    .map((featureId) => lifecycles.get(featureId))
    .filter((lifecycle): lifecycle is FeatureLifecycle => Boolean(lifecycle))
  for (const lifecycle of lifecycles.values()) {
    if (enabledFeatureIds.has(lifecycle.featureId) && !orderedIds.has(lifecycle.featureId)) ordered.push(lifecycle)
  }
  return ordered
}

export async function runFeatureInit(enabledFeatureIds: ReadonlySet<string>): Promise<string[]> {
  const failed: string[] = []
  for (const lifecycle of orderedLifecycles(enabledFeatureIds)) {
    if (!lifecycle.init) continue
    try {
      await lifecycle.init()
    } catch (error) {
      failed.push(lifecycle.featureId)
      setFeatureUnavailable(
        lifecycle.featureId,
        error instanceof Error ? `feature_init_failed:${error.message}` : 'feature_init_failed',
      )
      console.error(`Feature "${lifecycle.featureId}" failed to initialize:`, error)
    }
  }
  return failed
}

export async function runFeatureAppResume(enabledFeatureIds: ReadonlySet<string>): Promise<void> {
  for (const lifecycle of orderedLifecycles(enabledFeatureIds)) {
    if (!lifecycle.onAppResume) continue
    try {
      await lifecycle.onAppResume()
    } catch (error) {
      console.error(`Feature "${lifecycle.featureId}" failed during app resume:`, error)
    }
  }
}

export interface AgentRunLifecycleHandle {
  disposeAll(): Promise<void>
  getFeatureState<T>(featureId: string): T | undefined
}

export async function beginAgentRun(
  context: Omit<AgentRunContext, 'setFeatureState' | 'getFeatureState'>,
  enabledFeatureIds: ReadonlySet<string>,
): Promise<AgentRunLifecycleHandle> {
  const cleanups: AgentRunCleanup[] = []
  const state = new Map<string, unknown>()
  const fullContext: AgentRunContext = {
    ...context,
    setFeatureState: (featureId, value) => state.set(featureId, value),
    getFeatureState: <T>(featureId: string) => state.get(featureId) as T | undefined,
  }

  for (const lifecycle of orderedLifecycles(enabledFeatureIds)) {
    if (!lifecycle.onAgentRunStart) continue
    try {
      const cleanup = await lifecycle.onAgentRunStart(fullContext)
      if (cleanup) cleanups.push(cleanup)
    } catch (error) {
      console.error(`Feature "${lifecycle.featureId}" failed to prepare an Agent run:`, error)
    }
  }

  let disposed = false
  return {
    getFeatureState: <T>(featureId: string) => state.get(featureId) as T | undefined,
    async disposeAll() {
      if (disposed) return
      disposed = true
      const errors: unknown[] = []
      for (const cleanup of [...cleanups].reverse()) {
        try {
          await cleanup()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, 'One or more feature Agent-run cleanups failed.')
    },
  }
}
