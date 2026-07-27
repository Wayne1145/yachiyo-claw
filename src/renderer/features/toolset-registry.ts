import type { ToolSet } from 'ai'
import { getFeature } from '@shared/features/registry'
import type { FeatureToolsetFactory, ToolsetContext, ToolsetContribution } from './toolset-contract'

/**
 * Registry that composes feature toolset contributions (migration-02).
 *
 * Composition rules (locked by tests):
 * - Factories run in registration order so the same enabled set yields a deterministic `instructions`
 *   string (important for prompt caching). The final switchover will order by `resolveFeatureOrder`.
 * - A tool-name collision across contributions THROWS — a duplicate name would make the model call the
 *   wrong implementation, so it must surface in development (unlike a runtime data error).
 * - A factory that throws is logged and skipped; the other modules still contribute. This mirrors the
 *   existing try/catch around the knowledge-base toolset. A collision is a programming error and is not
 *   swallowed by this isolation.
 * - `activeTools`: a contribution without `initialActiveTools` makes all of its tools initially visible;
 *   one with `initialActiveTools` stages only those. If no contribution stages, `activeTools` is
 *   omitted (all tools visible) — matching today's behavior.
 */
const factories = new Map<string, FeatureToolsetFactory>()
const toolDisplay = new Map<string, NonNullable<ToolsetContribution['toolDisplay']>[string]>()

export function registerFeatureToolset(featureId: string, factory: FeatureToolsetFactory): void {
  if (factories.has(featureId)) {
    throw new Error(`Feature toolset "${featureId}" is already registered.`)
  }
  factories.set(featureId, factory)
}

export function getRegisteredFeatureToolsetIds(): string[] {
  return Array.from(factories.keys())
}

export function hasFeatureToolset(featureId: string): boolean {
  return factories.has(featureId)
}

export function resetFeatureToolsetRegistry(): void {
  factories.clear()
  toolDisplay.clear()
}

export function getRegisteredToolDisplay(toolName: string) {
  return toolDisplay.get(toolName)
}

export interface BuiltToolsets {
  tools: ToolSet
  instructions: string
  activeTools?: string[]
  /** Contributions that actually produced tools or instructions for this build. */
  activeFeatureIds: string[]
}

export async function buildRegisteredToolsets(context: ToolsetContext): Promise<BuiltToolsets> {
  const contributions: Array<{ featureId: string; contribution: ToolsetContribution }> = []
  for (const [featureId, factory] of factories) {
    if (context.enabledFeatureIds && getFeature(featureId) && !context.enabledFeatureIds.has(featureId)) continue
    let contribution: ToolsetContribution | null
    try {
      contribution = await factory(context)
    } catch (error) {
      console.error(`Feature toolset "${featureId}" failed to build:`, error)
      continue
    }
    if (contribution) contributions.push({ featureId, contribution })
  }

  const tools: ToolSet = {}
  let instructions = ''
  const active = new Set<string>()
  let anyStaged = false

  for (const { contribution } of contributions) {
    instructions += contribution.instructions
    const names = Object.keys(contribution.tools)
    for (const name of names) {
      if (name in tools) throw new Error(`Duplicate tool name "${name}" from multiple feature toolsets.`)
      tools[name] = contribution.tools[name]
      const display = contribution.toolDisplay?.[name]
      if (display) toolDisplay.set(name, display)
    }
    if (contribution.initialActiveTools) {
      anyStaged = true
      for (const name of contribution.initialActiveTools) active.add(name)
    } else {
      for (const name of names) active.add(name)
    }
  }

  return {
    tools,
    instructions,
    activeFeatureIds: contributions.map(({ featureId }) => featureId),
    ...(anyStaged ? { activeTools: [...active] } : {}),
  }
}
