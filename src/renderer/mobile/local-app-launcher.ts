import {
  type AccessibilityActionResult,
  type AccessibilitySelector,
  type LauncherContext,
  parseSemanticSnapshot,
  type SemanticNode,
  type SemanticSnapshot,
  yachiyoDeviceAccessNative,
} from '@/platform/native/yachiyo_device_access'
import { type AgentBrokerCallContext, executeAccessibilityAction, executeAppLaunch } from './agent-broker'
import {
  executeLocalLaunchOrder,
  type LaunchableApp,
  type NativeLaunchResult,
  normalizeAppQuery,
} from './android-app-index'
import {
  createLauncherPlacementCache,
  type LauncherEnvironment,
  type LauncherPlacement,
  type PlacementObservation,
} from './launcher-placement-cache'

export interface LocalAppLauncherOptions {
  storage?: {
    getStoreValue(key: string): Promise<unknown>
    setStoreValue(key: string, value: unknown): Promise<void>
    delStoreValue?(key: string): Promise<void>
  }
  now?: () => number
  onOperation?: () => void | Promise<void>
}

function stageContext(base: AgentBrokerCallContext, stage: string): AgentBrokerCallContext {
  const seed = base.callId || base.toolCallId || `local-launch-${Date.now().toString(36)}`
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const compactSeed = seed.length > 88 ? `${seed.slice(0, 72)}-${(hash >>> 0).toString(36)}` : seed
  const identifier = `${compactSeed}-${stage}`.slice(0, 120)
  return {
    taskId: base.taskId,
    stepId: identifier,
    callId: identifier,
    attempt: 1,
    deadline: base.deadline,
    abortSignal: base.abortSignal,
  }
}

function actionResult(result: AccessibilityActionResult): NativeLaunchResult {
  return {
    success: result.success,
    output: result.output || result.node,
    error: result.success ? undefined : result.reason || 'launcher_action_failed',
  }
}

function normalizedLabels(app: LaunchableApp): Set<string> {
  return new Set([app.label, ...(app.aliases || [])].map(normalizeAppQuery).filter(Boolean))
}

function nodeLabel(node: SemanticNode): string {
  return node.text || node.contentDescription || ''
}

function nodeSelector(node: SemanticNode, packageName: string): AccessibilitySelector {
  return {
    packageName,
    ...(node.text ? { text: node.text } : {}),
    ...(node.contentDescription ? { contentDescription: node.contentDescription } : {}),
    ...(node.resourceId ? { resourceId: node.resourceId } : {}),
    ...(node.role ? { role: node.role } : {}),
    ...(node.ancestorSignature ? { ancestorSignature: node.ancestorSignature } : {}),
  }
}

function matchingAppNodes(
  snapshot: SemanticSnapshot,
  app: LaunchableApp,
  expectedPackageName?: string
): SemanticNode[] {
  const labels = normalizedLabels(app)
  return snapshot.nodes
    .filter(
      (node) =>
        node.visible &&
        labels.has(normalizeAppQuery(nodeLabel(node))) &&
        (!expectedPackageName || !node.packageName || node.packageName === expectedPackageName)
    )
    .sort((left, right) => Number(right.clickable) - Number(left.clickable))
}

function boundsCenter(node: SemanticNode): { x: number; y: number } {
  return {
    x: (node.bounds.left + node.bounds.right) / 2,
    y: (node.bounds.top + node.bounds.bottom) / 2,
  }
}

/**
 * A launcher can expose the same label more than once.  Search must refuse an
 * arbitrary duplicate; a cached bounds hint may disambiguate one exact icon.
 */
function findAppNode(
  snapshot: SemanticSnapshot,
  app: LaunchableApp,
  preferredBounds?: LauncherPlacement['bounds'],
  expectedPackageName?: string
): SemanticNode | null {
  const matches = matchingAppNodes(snapshot, app, expectedPackageName)
  if (!matches.length) return null
  if (preferredBounds) {
    const expected = {
      x: (preferredBounds.left + preferredBounds.right) / 2,
      y: (preferredBounds.top + preferredBounds.bottom) / 2,
    }
    const ranked = matches
      .map((node) => {
        const center = boundsCenter(node)
        return {
          node,
          distance: Math.hypot(center.x - expected.x, center.y - expected.y),
        }
      })
      .sort((left, right) => left.distance - right.distance)
    const nearest = ranked[0]
    const second = ranked[1]
    const iconSize = Math.max(
      preferredBounds.right - preferredBounds.left,
      preferredBounds.bottom - preferredBounds.top,
      1
    )
    if (
      nearest &&
      nearest.distance <= iconSize * 1.5 &&
      (!second || second.distance - nearest.distance > iconSize * 0.25)
    ) {
      return nearest.node
    }
    return null
  }

  const clickable = matches.filter((node) => node.clickable)
  return clickable.length === 1 ? clickable[0] : matches.length === 1 ? matches[0] : null
}

function findLauncherSearchNode(snapshot: SemanticSnapshot): SemanticNode | null {
  return (
    snapshot.nodes
      .filter((node) => node.visible && (node.role === 'textbox' || node.editable))
      .filter((node) => {
        const marker = normalizeAppQuery(`${node.resourceId || ''} ${node.contentDescription || ''} ${node.text || ''}`)
        return (
          marker.includes('allapps') ||
          marker.includes('appssearch') ||
          marker.includes('appdrawersearch') ||
          marker.includes('搜索应用') ||
          marker.includes('应用搜索')
        )
      })[0] || null
  )
}

function parseObserved(result: AccessibilityActionResult): SemanticSnapshot | null {
  return parseSemanticSnapshot(result.output)
}

function sameIdentifier(left: string | number | undefined, right: string | number | undefined): boolean {
  return left !== undefined && right !== undefined && String(left) === String(right)
}

function environmentForPlacement(context: LauncherContext, placement: LauncherPlacement): LauncherEnvironment {
  return {
    launcherPackage: context.launcherPackage,
    launcherVersionCode: context.launcherVersionCode,
    displayId: context.displayId,
    orientation: context.orientation,
    density: context.density,
    gridRows: placement.gridRows,
    gridColumns: placement.gridColumns,
  }
}

function contextMatchesPlacement(context: LauncherContext, placement: LauncherPlacement): boolean {
  return (
    placement.launcherPackage === context.launcherPackage &&
    sameIdentifier(placement.launcherVersionCode, context.launcherVersionCode) &&
    sameIdentifier(placement.displayId, context.displayId) &&
    placement.orientation === context.orientation &&
    Math.abs(placement.density - context.density) < 0.05
  )
}

function uniqueCenters(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value / 8) * 8))].sort((left, right) => left - right)
}

function inferCell(
  snapshot: SemanticSnapshot,
  target: SemanticNode
): { rows: number; columns: number; row: number; column: number } | null {
  const iconNodes = snapshot.nodes.filter(
    (node) =>
      node.visible &&
      node.bounds.right > node.bounds.left &&
      node.bounds.bottom > node.bounds.top &&
      (!node.packageName || node.packageName === snapshot.packageName) &&
      Boolean(node.text || node.contentDescription) &&
      (node.clickable ||
        node.role === 'button' ||
        node.role === 'image' ||
        node.resourceId?.toLowerCase().includes('icon'))
  )
  const columns = uniqueCenters(iconNodes.map((node) => (node.bounds.left + node.bounds.right) / 2))
  const rows = uniqueCenters(iconNodes.map((node) => (node.bounds.top + node.bounds.bottom) / 2))
  if (!columns.length || !rows.length || columns.length > 50 || rows.length > 50) return null
  const targetX = (target.bounds.left + target.bounds.right) / 2
  const targetY = (target.bounds.top + target.bounds.bottom) / 2
  const column = columns.reduce(
    (best, value, index) => (Math.abs(value - targetX) < Math.abs(columns[best] - targetX) ? index : best),
    0
  )
  const row = rows.reduce(
    (best, value, index) => (Math.abs(value - targetY) < Math.abs(rows[best] - targetY) ? index : best),
    0
  )
  return { rows: rows.length, columns: columns.length, row, column }
}

export class LocalAppLauncher {
  private readonly cache: ReturnType<typeof createLauncherPlacementCache>
  private readonly now: () => number
  private readonly onOperation?: () => void | Promise<void>

  constructor(options: LocalAppLauncherOptions = {}) {
    this.cache = createLauncherPlacementCache({ storage: options.storage, now: options.now })
    this.now = options.now || (() => Date.now())
    this.onOperation = options.onOperation
  }

  launch(app: LaunchableApp, context: AgentBrokerCallContext = {}): Promise<NativeLaunchResult & { method?: string }> {
    const runtimeContext = stageContext(context, 'intent')
    let effectiveApp = app
    const prepareFallbackApp = async (): Promise<LaunchableApp> => {
      if (effectiveApp.label !== effectiveApp.packageName) return effectiveApp
      try {
        const indexed = (await yachiyoDeviceAccessNative.listLaunchableApps()).apps.find(
          (candidate) => candidate.packageName === effectiveApp.packageName
        )
        if (indexed) effectiveApp = indexed
      } catch {
        // A package-only launch can still fall through to the manual path.
      }
      return effectiveApp
    }
    return executeLocalLaunchOrder(
      async () => {
        await this.onOperation?.()
        return actionResult(
          await executeAppLaunch(app.packageName, app.launchActivity || app.activityName, runtimeContext)
        )
      },
      {
        launcherSearch: async () => this.tryLauncherSearch(await prepareFallbackApp(), context),
        verifiedPlacement: async () => this.tryVerifiedPlacement(await prepareFallbackApp(), context),
        manualFallback: async () => this.discoverAndCachePlacement(await prepareFallbackApp(), context),
      }
    )
  }

  private async observe(context: AgentBrokerCallContext, stage: string): Promise<SemanticSnapshot | null> {
    await this.onOperation?.()
    const result = await executeAccessibilityAction({ action: 'observeSemantic' }, stageContext(context, stage))
    return parseObserved(result)
  }

  private async tryLauncherSearch(app: LaunchableApp, context: AgentBrokerCallContext): Promise<NativeLaunchResult> {
    const launcherContext = await yachiyoDeviceAccessNative.getLauncherContext().catch(() => null)
    const snapshot = await this.observe(context, 'search-observe')
    if (!snapshot || !launcherContext || snapshot.packageName !== launcherContext.launcherPackage) {
      return { success: false, error: 'launcher_search_unavailable' }
    }
    const searchNode = findLauncherSearchNode(snapshot)
    if (!searchNode) return { success: false, error: 'launcher_search_unavailable' }
    await this.onOperation?.()
    const setText = await executeAccessibilityAction(
      {
        action: 'setNodeText',
        ...nodeSelector(searchNode, snapshot.packageName),
        selectorText: searchNode.text,
        text: app.label,
      },
      stageContext(context, 'search-input')
    )
    if (!setText.success) return actionResult(setText)
    const results = await this.observe(context, 'search-results')
    const match = results && findAppNode(results, app, undefined, launcherContext.launcherPackage)
    if (!results || !match) return { success: false, error: 'launcher_search_not_found' }
    await this.onOperation?.()
    return actionResult(
      await executeAccessibilityAction(
        { action: 'clickNode', ...nodeSelector(match, results.packageName) },
        stageContext(context, 'search-click')
      )
    )
  }

  private async tryVerifiedPlacement(app: LaunchableApp, context: AgentBrokerCallContext): Promise<NativeLaunchResult> {
    const launcherContext = await yachiyoDeviceAccessNative.getLauncherContext().catch(() => null)
    if (!launcherContext) return { success: false, error: 'launcher_context_unavailable' }
    let currentSnapshot = await this.observe(context, 'placement-current-observe')
    if (!currentSnapshot || currentSnapshot.packageName !== launcherContext.launcherPackage) {
      await this.onOperation?.()
      const home = await executeAccessibilityAction({ action: 'global', key: 'HOME' }, stageContext(context, 'home'))
      if (!home.success) return actionResult(home)
      currentSnapshot = await this.observe(context, 'placement-home-observe')
    }
    const entries = (await this.cache.list()).filter(
      (entry) => entry.packageName === app.packageName && contextMatchesPlacement(launcherContext, entry)
    )
    for (const entry of entries.sort((left, right) => right.confidence - left.confidence)) {
      const environment = environmentForPlacement(launcherContext, entry)
      let matched: SemanticNode | null = null
      const verified = await this.cache.getVerified(app.packageName, environment, async (placement) => {
        const snapshot = currentSnapshot || (await this.observe(context, 'placement-observe'))
        currentSnapshot = null
        if (!snapshot || snapshot.packageName !== launcherContext.launcherPackage) return false
        matched = findAppNode(snapshot, app, placement.bounds, launcherContext.launcherPackage)
        const cell = matched ? inferCell(snapshot, matched) : null
        if (!matched || !cell || cell.rows !== placement.gridRows || cell.columns !== placement.gridColumns)
          return false
        const observation: PlacementObservation = {
          packageName: app.packageName,
          label: nodeLabel(matched),
          bounds: matched.bounds,
          pageIndex: placement.pageIndex,
          cellRow: cell.row,
          cellColumn: cell.column,
          screenSignature: snapshot.screenSignature,
        }
        return observation
      })
      if (!verified || !matched) continue
      await this.onOperation?.()
      const clicked = await executeAccessibilityAction(
        { action: 'clickNode', ...nodeSelector(matched, launcherContext.launcherPackage) },
        stageContext(context, 'placement-click')
      )
      if (clicked.success) return actionResult(clicked)
      await this.cache.invalidate(app.packageName, environment)
    }
    return { success: false, error: 'verified_placement_not_found' }
  }

  private async discoverAndCachePlacement(
    app: LaunchableApp,
    context: AgentBrokerCallContext
  ): Promise<NativeLaunchResult> {
    const launcherContext = await yachiyoDeviceAccessNative.getLauncherContext().catch(() => null)
    if (!launcherContext) return { success: false, error: 'launcher_context_unavailable' }
    const snapshot = await this.observe(context, 'manual-observe')
    const match = snapshot && findAppNode(snapshot, app, undefined, launcherContext.launcherPackage)
    if (!snapshot || !match || snapshot.packageName !== launcherContext.launcherPackage) {
      return { success: false, error: 'manual_launcher_fallback_required' }
    }
    const cell = inferCell(snapshot, match)
    if (!cell) return { success: false, error: 'launcher_grid_unavailable' }
    await this.cache.put({
      launcherPackage: launcherContext.launcherPackage,
      launcherVersionCode: launcherContext.launcherVersionCode,
      displayId: launcherContext.displayId,
      orientation: launcherContext.orientation,
      density: launcherContext.density,
      gridRows: cell.rows,
      gridColumns: cell.columns,
      packageName: app.packageName,
      activityName: app.launchActivity || app.activityName,
      pageIndex: 0,
      cellRow: cell.row,
      cellColumn: cell.column,
      bounds: match.bounds,
      confidence: 0.8,
      observedAt: this.now(),
      label: nodeLabel(match),
      screenSignature: snapshot.screenSignature,
    })
    await this.onOperation?.()
    const clicked = await executeAccessibilityAction(
      { action: 'clickNode', ...nodeSelector(match, launcherContext.launcherPackage) },
      stageContext(context, 'manual-click')
    )
    if (!clicked.success) {
      await this.cache.invalidate(app.packageName, {
        launcherPackage: launcherContext.launcherPackage,
        launcherVersionCode: launcherContext.launcherVersionCode,
        displayId: launcherContext.displayId,
        orientation: launcherContext.orientation,
        density: launcherContext.density,
        gridRows: cell.rows,
        gridColumns: cell.columns,
      })
    }
    return actionResult(clicked)
  }
}

export function createLocalAppLauncher(options: LocalAppLauncherOptions = {}): LocalAppLauncher {
  return new LocalAppLauncher(options)
}
