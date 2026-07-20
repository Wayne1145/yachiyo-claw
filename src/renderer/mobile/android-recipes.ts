import {
  type AccessibilitySelector,
  AccessibilitySelectorSchema,
  type BackendKind,
  type GoalSpec,
  GoalSpecSchema,
  type JsonValue,
  type SemanticSnapshot,
  SemanticSnapshotSchema,
} from '@shared/agent'
import type { AccessibilityActionResult, AccessibilityActionOptions } from '@/platform/native/yachiyo_device_access'
import { executeAccessibilityAction, executeAppLaunch, type AgentBrokerCallContext } from './agent-broker'
import { createAndroidAppIndex, type AndroidAppIndex, type LaunchableApp, normalizeAppQuery } from './android-app-index'

export const ANDROID_RECIPE_STORAGE_KEY = 'yachiyo.android.recipes.v1'
export const ANDROID_RECIPE_RESULT_MAX_BYTES = 8 * 1024
export const ANDROID_RECIPE_MAX_ACTIONS = 20
export const ANDROID_RECIPE_SCHEMA_VERSION = 1 as const

export type AndroidRecipeStepKind =
  | 'launch'
  | 'observeSemantic'
  | 'findNode'
  | 'clickNode'
  | 'setNodeText'
  | 'scrollNode'
  | 'global'
  | 'waitFor'
  | 'verify'

export interface RecipeStepBase {
  id?: string
  kind: AndroidRecipeStepKind
  /** Optional expected state is used by the Broker verification hook. */
  expectedState?: JsonValue
}

export interface LaunchRecipeStep extends RecipeStepBase {
  kind: 'launch'
  packageName?: string
  appName?: string
}

export interface ObserveRecipeStep extends RecipeStepBase {
  kind: 'observeSemantic'
}

export interface SelectorRecipeStep extends RecipeStepBase {
  kind: 'findNode' | 'clickNode'
  selector: AccessibilitySelector
}

export interface SetTextRecipeStep extends RecipeStepBase {
  kind: 'setNodeText'
  selector: AccessibilitySelector
  text: string
  parameterKey?: string
  /** Sensitive text is executable but never persisted or returned. */
  sensitive?: boolean
}

export interface ScrollRecipeStep extends RecipeStepBase {
  kind: 'scrollNode'
  selector: AccessibilitySelector
  direction: NonNullable<AccessibilityActionOptions['direction']>
}

export interface GlobalRecipeStep extends RecipeStepBase {
  kind: 'global'
  key: string
}

export interface WaitForRecipeStep extends RecipeStepBase {
  kind: 'waitFor'
  timeoutMs?: number
  pollMs?: number
  selector?: AccessibilitySelector
}

export interface VerifyRecipeStep extends RecipeStepBase {
  kind: 'verify'
  selector?: AccessibilitySelector
  expectedText?: string
}

export type RecipeStep =
  | LaunchRecipeStep
  | ObserveRecipeStep
  | SelectorRecipeStep
  | SetTextRecipeStep
  | ScrollRecipeStep
  | GlobalRecipeStep
  | WaitForRecipeStep
  | VerifyRecipeStep

export interface AndroidRecipeDescriptor {
  id: string
  version: number
  appPackages: readonly string[]
  aliases: readonly string[]
  supportedBackends: readonly BackendKind[]
  steps: readonly RecipeStep[]
  expectedState: JsonValue
  risk: 'read' | 'act' | 'destructive'
  maxActions: number
  appVersion?: string
  screenSignature?: string
  /** User confirmation is intentionally part of the persisted contract. */
  confirmedAt?: number
}

export interface RecipeEnvironment {
  backend: BackendKind
  app?: LaunchableApp
  screenSignature?: string
  appVersion?: string | number
}

export interface RecipeMatch {
  kind: 'matched' | 'ambiguous' | 'not_found' | 'invalid'
  recipe?: AndroidRecipeDescriptor
  app?: LaunchableApp
  candidates?: AndroidRecipeDescriptor[]
  reason?: string
}

export interface RecipeStorage {
  getStoreValue(key: string): Promise<unknown>
  setStoreValue(key: string, value: unknown): Promise<void>
}

export interface RecipeExecutionHost {
  launch(app: LaunchableApp, context: AgentBrokerCallContext): Promise<AccessibilityActionResult>
  observeSemantic(context: AgentBrokerCallContext): Promise<AccessibilityActionResult>
  findNode(selector: AccessibilitySelector, context: AgentBrokerCallContext): Promise<AccessibilityActionResult>
  clickNode(selector: AccessibilitySelector, context: AgentBrokerCallContext): Promise<AccessibilityActionResult>
  setNodeText(
    selector: AccessibilitySelector,
    text: string,
    context: AgentBrokerCallContext,
  ): Promise<AccessibilityActionResult>
  scrollNode(
    selector: AccessibilitySelector,
    direction: NonNullable<AccessibilityActionOptions['direction']>,
    context: AgentBrokerCallContext,
  ): Promise<AccessibilityActionResult>
  global(key: string, context: AgentBrokerCallContext): Promise<AccessibilityActionResult>
  verify(
    expectedState: JsonValue,
    selector: AccessibilitySelector | undefined,
    expectedText: string | undefined,
    context: AgentBrokerCallContext,
  ): Promise<boolean>
}

export interface RecipeRunOptions {
  taskId: string
  deadline?: number
  abortSignal?: AbortSignal
  /** Kept for callers that prefer passing a host per run; the runner's host wins. */
  host?: RecipeExecutionHost
  /** Ephemeral values for redacted sensitive steps; never persisted. */
  parameters?: Record<string, string>
}

export interface RecipeRunResult {
  status: 'applied' | 'verified' | 'unknown' | 'failed'
  stepIndex: number
  summary: string
  digest: string
  bytes: number
}

export interface StoredRecipeAttemptOptions extends Omit<RecipeRunOptions, 'host'> {
  backend: BackendKind
  host: RecipeExecutionHost
  storage?: RecipeStorage
  appIndex?: Pick<AndroidAppIndex, 'resolve'>
  confirm?: (recipe: AndroidRecipeDescriptor) => Promise<boolean> | boolean
}

export interface StoredRecipeAttempt {
  matched: boolean
  match: RecipeMatch
  result?: RecipeRunResult
  reason?: 'not_found' | 'ambiguous' | 'confirmation_required' | 'storage_unavailable'
}

const PACKAGE_PATTERN = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/
const MAX_RECIPE_COUNT = 100
const MAX_STEP_ID_LENGTH = 80

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isJsonValue)
  return false
}

function sanitizeSelector(value: unknown): AccessibilitySelector | null {
  const parsed = AccessibilitySelectorSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function sanitizeStep(raw: unknown): RecipeStep | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const kind = text(value.kind, 40) as AndroidRecipeStepKind | undefined
  const id = text(value.id, MAX_STEP_ID_LENGTH)
  const expectedState =
    value.expectedState === undefined ? undefined : isJsonValue(value.expectedState) ? value.expectedState : null
  if (value.expectedState !== undefined && expectedState === null) return null
  const base = {
    ...(id ? { id } : {}),
    kind: kind as AndroidRecipeStepKind,
    ...(expectedState !== undefined ? { expectedState } : {}),
  }
  switch (kind) {
    case 'launch': {
      const packageName = text(value.packageName, 256)
      const appName = text(value.appName, 200)
      if (!packageName && !appName) return null
      if (packageName && !PACKAGE_PATTERN.test(packageName)) return null
      return { ...base, kind, ...(packageName ? { packageName } : {}), ...(appName ? { appName } : {}) }
    }
    case 'observeSemantic':
      return { ...base, kind }
    case 'findNode':
    case 'clickNode': {
      const selector = sanitizeSelector(value.selector)
      return selector ? { ...base, kind, selector } : null
    }
    case 'setNodeText': {
      const selector = sanitizeSelector(value.selector)
      const stepText = typeof value.text === 'string' ? value.text.slice(0, 4_000) : null
      if (!selector || stepText === null) return null
      const parameterKey = text(value.parameterKey, 80)
      return {
        ...base,
        kind,
        selector,
        text: stepText,
        ...(parameterKey ? { parameterKey } : {}),
        ...(value.sensitive === true ? { sensitive: true } : {}),
      }
    }
    case 'scrollNode': {
      const selector = sanitizeSelector(value.selector)
      const direction = text(value.direction, 20) as ScrollRecipeStep['direction'] | undefined
      if (!selector || !direction || !['up', 'down', 'left', 'right', 'forward', 'backward'].includes(direction))
        return null
      return { ...base, kind, selector, direction }
    }
    case 'global': {
      const key = text(value.key, 40)
      return key ? { ...base, kind, key } : null
    }
    case 'waitFor': {
      const timeoutMs =
        typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs) ? Math.floor(value.timeoutMs) : 2_000
      const pollMs = typeof value.pollMs === 'number' && Number.isFinite(value.pollMs) ? Math.floor(value.pollMs) : 200
      const selector = value.selector === undefined ? undefined : sanitizeSelector(value.selector)
      if (value.selector !== undefined && !selector) return null
      if (timeoutMs < 1 || timeoutMs > 10_000 || pollMs < 25 || pollMs > 2_000) return null
      return { ...base, kind, timeoutMs, pollMs, ...(selector ? { selector } : {}) }
    }
    case 'verify': {
      const selector = value.selector === undefined ? undefined : sanitizeSelector(value.selector)
      const expectedText = value.expectedText === undefined ? undefined : text(value.expectedText, 500)
      if (value.selector !== undefined && !selector) return null
      if (!selector && !expectedText && expectedState === undefined) return null
      return { ...base, kind, ...(selector ? { selector } : {}), ...(expectedText ? { expectedText } : {}) }
    }
    default:
      return null
  }
}

const RECIPE_RISK_LEVEL = { read: 0, act: 1, destructive: 2 } as const

/** Derive the minimum risk from executable steps instead of trusting imported metadata. */
export function deriveRecipeRisk(steps: readonly RecipeStep[]): AndroidRecipeDescriptor['risk'] {
  let risk: AndroidRecipeDescriptor['risk'] = 'read'
  for (const step of steps) {
    const stepRisk: AndroidRecipeDescriptor['risk'] =
      step.kind === 'setNodeText' && step.sensitive
        ? 'destructive'
        : ['launch', 'clickNode', 'setNodeText', 'scrollNode', 'global'].includes(step.kind)
          ? 'act'
          : 'read'
    if (RECIPE_RISK_LEVEL[stepRisk] > RECIPE_RISK_LEVEL[risk]) risk = stepRisk
  }
  return risk
}

export function sanitizeRecipeDescriptor(raw: unknown): AndroidRecipeDescriptor | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = text(value.id, 128)
  const version = typeof value.version === 'number' && Number.isInteger(value.version) ? value.version : 0
  const packages = Array.isArray(value.appPackages)
    ? value.appPackages
        .filter((item): item is string => typeof item === 'string' && PACKAGE_PATTERN.test(item))
        .slice(0, 32)
    : []
  const aliases = Array.isArray(value.aliases)
    ? value.aliases
        .filter((item): item is string => typeof item === 'string' && Boolean(normalizeAppQuery(item)))
        .map((item) => item.trim().slice(0, 200))
        .slice(0, 32)
    : []
  const backends = Array.isArray(value.supportedBackends)
    ? value.supportedBackends.filter(
        (item): item is BackendKind =>
          ['standard', 'accessibility', 'adb', 'shizuku', 'root', 'companion'].includes(String(item)) as boolean,
      )
    : []
  const steps = Array.isArray(value.steps)
    ? value.steps
        .map(sanitizeStep)
        .filter((step): step is RecipeStep => Boolean(step))
        .slice(0, ANDROID_RECIPE_MAX_ACTIONS)
    : []
  const expectedState = isJsonValue(value.expectedState) ? value.expectedState : {}
  const declaredRisk = value.risk === 'read' || value.risk === 'act' || value.risk === 'destructive' ? value.risk : null
  const maxActions = typeof value.maxActions === 'number' && Number.isInteger(value.maxActions) ? value.maxActions : 0
  if (!id || version < 1 || !packages.length || !aliases.length || !backends.length || !steps.length || !declaredRisk)
    return null
  if (maxActions < 1 || maxActions > ANDROID_RECIPE_MAX_ACTIONS || steps.length > maxActions) return null
  if (value.confirmedAt !== undefined && (typeof value.confirmedAt !== 'number' || !Number.isFinite(value.confirmedAt)))
    return null
  const sanitizedSteps = steps.map((step) =>
    step.kind === 'setNodeText' && step.sensitive ? { ...step, text: '' } : step,
  )
  const derivedRisk = deriveRecipeRisk(sanitizedSteps)
  const risk = RECIPE_RISK_LEVEL[declaredRisk] >= RECIPE_RISK_LEVEL[derivedRisk] ? declaredRisk : derivedRisk
  const descriptor: AndroidRecipeDescriptor = {
    id,
    version,
    appPackages: [...new Set(packages)],
    aliases: [...new Set(aliases)],
    supportedBackends: [...new Set(backends)],
    steps: sanitizedSteps,
    expectedState,
    risk,
    maxActions,
    ...(text(value.appVersion, 128) ? { appVersion: text(value.appVersion, 128) } : {}),
    ...(text(value.screenSignature, 128) ? { screenSignature: text(value.screenSignature, 128) } : {}),
    ...(typeof value.confirmedAt === 'number' ? { confirmedAt: value.confirmedAt } : {}),
  }
  return descriptor
}

function recipeMatchesGoal(recipe: AndroidRecipeDescriptor, goal: GoalSpec, app: LaunchableApp | undefined): boolean {
  if (app && !recipe.appPackages.includes(app.packageName)) return false
  if (
    !app &&
    goal.targetAppName &&
    !recipe.aliases.some((alias) => normalizeAppQuery(goal.targetAppName || '').includes(normalizeAppQuery(alias)))
  ) {
    // The objective may contain the alias even when App Index is unavailable.
    const objective = normalizeAppQuery(goal.objective)
    if (!recipe.aliases.some((alias) => objective.includes(normalizeAppQuery(alias)))) return false
  }
  const objective = normalizeAppQuery(`${goal.targetAppName || ''} ${goal.objective}`)
  return recipe.aliases.some((alias) => objective.includes(normalizeAppQuery(alias)))
}

export class AndroidRecipeMatcher {
  constructor(private readonly appIndex: Pick<AndroidAppIndex, 'resolve'>) {}

  async match(
    goal: GoalSpec,
    recipes: readonly AndroidRecipeDescriptor[],
    environment: RecipeEnvironment,
  ): Promise<RecipeMatch> {
    const valid = recipes
      .map(sanitizeRecipeDescriptor)
      .filter((recipe): recipe is AndroidRecipeDescriptor => Boolean(recipe))
    const app = goal.targetAppName ? await this.appIndex.resolve(goal.targetAppName).catch(() => null) : null
    const resolvedApp = app?.kind === 'resolved' ? app.app : undefined
    const candidates = valid.filter((recipe) => {
      if (!recipe.supportedBackends.includes(environment.backend)) return false
      if (
        recipe.appVersion !== undefined &&
        String(recipe.appVersion) !== String(environment.appVersion ?? resolvedApp?.versionCode ?? '')
      )
        return false
      if (recipe.screenSignature && recipe.screenSignature !== environment.screenSignature) return false
      return recipeMatchesGoal(recipe, goal, environment.app || resolvedApp)
    })
    if (candidates.length === 1) return { kind: 'matched', recipe: candidates[0], app: environment.app || resolvedApp }
    if (candidates.length > 1) return { kind: 'ambiguous', candidates }
    return { kind: 'not_found', candidates: [] }
  }
}

export class AndroidRecipeStore {
  constructor(
    private readonly storage: RecipeStorage,
    private readonly key = ANDROID_RECIPE_STORAGE_KEY,
  ) {}

  async list(): Promise<AndroidRecipeDescriptor[]> {
    const raw = await this.storage.getStoreValue(this.key)
    if (!Array.isArray(raw)) return []
    return raw
      .map(sanitizeRecipeDescriptor)
      .filter((recipe): recipe is AndroidRecipeDescriptor => Boolean(recipe && recipe.confirmedAt))
      .slice(-MAX_RECIPE_COUNT)
  }

  async save(recipe: AndroidRecipeDescriptor, confirmed = false): Promise<AndroidRecipeDescriptor> {
    if (!confirmed) throw new Error('recipe_confirmation_required')
    const sanitized = sanitizeRecipeDescriptor({ ...recipe, confirmedAt: Date.now() })
    if (!sanitized) throw new Error('invalid_android_recipe')
    const current = await this.list()
    const next = [...current.filter((item) => item.id !== sanitized.id), sanitized].slice(-MAX_RECIPE_COUNT)
    await this.storage.setStoreValue(this.key, next)
    return sanitized
  }

  async remove(id: string): Promise<void> {
    const current = await this.list()
    await this.storage.setStoreValue(
      this.key,
      current.filter((item) => item.id !== id),
    )
  }
}

function digestString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}${value.length.toString(16).padStart(8, '0')}`
}

function boundedResult(result: RecipeRunResult): RecipeRunResult {
  const serialized = JSON.stringify(result)
  const bytes = new TextEncoder().encode(serialized).byteLength
  if (bytes <= ANDROID_RECIPE_RESULT_MAX_BYTES) return { ...result, bytes }
  const summary = result.summary.slice(0, 512)
  const bounded = { ...result, summary, bytes: 0 }
  bounded.bytes = new TextEncoder().encode(JSON.stringify(bounded)).byteLength
  return bounded
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('recipe_cancelled')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(new Error('recipe_cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export class AndroidRecipeRunner {
  constructor(private readonly host: RecipeExecutionHost) {}

  async run(
    recipe: AndroidRecipeDescriptor,
    options: RecipeRunOptions,
    resolvedApp?: LaunchableApp,
  ): Promise<RecipeRunResult> {
    const safe = sanitizeRecipeDescriptor(recipe)
    if (!safe)
      return boundedResult({ status: 'failed', stepIndex: -1, summary: 'invalid_recipe', digest: '', bytes: 0 })
    const deadline = options.deadline ?? Date.now() + 90_000
    let lastSnapshot: SemanticSnapshot | undefined
    let lastResult: AccessibilityActionResult | undefined
    for (let index = 0; index < safe.steps.length; index += 1) {
      if (Date.now() >= deadline)
        return boundedResult({
          status: 'unknown',
          stepIndex: index,
          summary: 'deadline_exceeded',
          digest: '',
          bytes: 0,
        })
      if (options.abortSignal?.aborted)
        return boundedResult({ status: 'unknown', stepIndex: index, summary: 'cancelled', digest: '', bytes: 0 })
      const step = safe.steps[index]
      const stepId = `${safe.id}-${index}`.slice(0, 120)
      const context: AgentBrokerCallContext = {
        taskId: options.taskId,
        stepId,
        callId: stepId,
        attempt: 1,
        deadline,
        abortSignal: options.abortSignal,
      }
      try {
        switch (step.kind) {
          case 'launch': {
            const app = step.packageName
              ? { packageName: step.packageName, label: step.appName || step.packageName }
              : step.appName && resolvedApp
                ? resolvedApp
                : undefined
            if (!app)
              return boundedResult({
                status: 'failed',
                stepIndex: index,
                summary: 'recipe_app_unresolved',
                digest: '',
                bytes: 0,
              })
            lastResult = await this.host.launch(app, context)
            break
          }
          case 'observeSemantic':
            lastResult = await this.host.observeSemantic(context)
            if (lastResult.output) {
              const parsed = SemanticSnapshotSchema.safeParse(JSON.parse(lastResult.output))
              if (parsed.success) lastSnapshot = parsed.data
            }
            break
          case 'findNode':
            lastResult = await this.host.findNode(step.selector, context)
            break
          case 'clickNode':
            lastResult = await this.host.clickNode(step.selector, context)
            break
          case 'setNodeText':
            // Empty text denotes a redacted persisted secret. It must be supplied
            // by a caller at runtime, otherwise refuse rather than typing nothing.
            const runtimeText =
              step.sensitive && !step.text ? options.parameters?.[step.parameterKey || step.id || 'text'] : step.text
            if (step.sensitive && !runtimeText) {
              return boundedResult({
                status: 'failed',
                stepIndex: index,
                summary: 'sensitive_parameter_required',
                digest: '',
                bytes: 0,
              })
            }
            lastResult = await this.host.setNodeText(step.selector, runtimeText || '', context)
            break
          case 'scrollNode':
            lastResult = await this.host.scrollNode(step.selector, step.direction, context)
            break
          case 'global':
            lastResult = await this.host.global(step.key, context)
            break
          case 'waitFor': {
            const timeout = step.timeoutMs ?? 2_000
            const poll = step.pollMs ?? 200
            const until = Date.now() + timeout
            let found = false
            while (Date.now() < until) {
              if (step.selector) {
                const result = await this.host.findNode(step.selector, { ...context, callId: `${stepId}-poll` })
                found = result.success || result.found === true
              } else {
                found = true
              }
              if (found) break
              await sleep(poll, options.abortSignal)
            }
            if (!found)
              return boundedResult({
                status: 'failed',
                stepIndex: index,
                summary: 'wait_timeout',
                digest: '',
                bytes: 0,
              })
            break
          }
          case 'verify': {
            const verified = await this.host.verify(
              step.expectedState ?? safe.expectedState,
              step.selector,
              step.expectedText,
              context,
            )
            if (!verified)
              return boundedResult({
                status: 'unknown',
                stepIndex: index,
                summary: 'verification_failed',
                digest: '',
                bytes: 0,
              })
            lastResult = { success: true, output: 'verified' }
            break
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (
          message.includes('recovery_required') ||
          message.includes('unknown') ||
          message.includes('already_applied')
        ) {
          return boundedResult({
            status: 'unknown',
            stepIndex: index,
            summary: 'recovery_required',
            digest: digestString(message),
            bytes: 0,
          })
        }
        return boundedResult({
          status: 'failed',
          stepIndex: index,
          summary: message.slice(0, 512),
          digest: digestString(message),
          bytes: 0,
        })
      }
      if (lastResult && !lastResult.success) {
        const reason = lastResult.reason || 'recipe_step_failed'
        if (reason.includes('recovery_required') || reason === 'already_applied') {
          return boundedResult({
            status: 'unknown',
            stepIndex: index,
            summary: 'recovery_required',
            digest: digestString(reason),
            bytes: 0,
          })
        }
        return boundedResult({
          status: 'failed',
          stepIndex: index,
          summary: reason.slice(0, 512),
          digest: digestString(reason),
          bytes: 0,
        })
      }
    }
    const verified = safe.steps.some((step) => step.kind === 'verify')
    const summary = verified ? 'recipe_verified' : 'recipe_applied'
    return boundedResult({
      status: verified ? 'verified' : 'applied',
      stepIndex: safe.steps.length - 1,
      summary,
      digest: digestString(
        JSON.stringify({ id: safe.id, version: safe.version, snapshot: lastSnapshot?.screenSignature }),
      ),
      bytes: 0,
    })
  }
}

export function createDefaultRecipeHost(): RecipeExecutionHost {
  return {
    launch: (app, context) => executeAppLaunch(app.packageName, app.launchActivity || app.activityName, context),
    observeSemantic: (context) => executeAccessibilityAction({ action: 'observeSemantic' }, context),
    findNode: (selector, context) => executeAccessibilityAction({ action: 'findNode', ...selector }, context),
    clickNode: (selector, context) => executeAccessibilityAction({ action: 'clickNode', ...selector }, context),
    setNodeText: (selector, text, context) =>
      executeAccessibilityAction({ action: 'setNodeText', ...selector, text, selectorText: selector.text }, context),
    scrollNode: (selector, direction, context) =>
      executeAccessibilityAction({ action: 'scrollNode', ...selector, direction }, context),
    global: (key, context) => executeAccessibilityAction({ action: 'global', key }, context),
    verify: async (expectedState, selector, expectedText, context) => {
      if (selector) {
        const result = await executeAccessibilityAction({ action: 'findNode', ...selector }, context)
        if (!result.success && !result.found) return false
        if (expectedText && result.output && !result.output.includes(expectedText)) return false
      }
      const observed = await executeAccessibilityAction({ action: 'observeSemantic' }, context)
      if (!observed.success || !observed.output) return false
      let snapshot: SemanticSnapshot
      try {
        snapshot = SemanticSnapshotSchema.parse(JSON.parse(observed.output))
      } catch {
        return false
      }
      if (expectedState && typeof expectedState === 'object' && !Array.isArray(expectedState)) {
        const expected = expectedState as Record<string, JsonValue>
        if (expected.packageName !== undefined && expected.packageName !== snapshot.packageName) return false
        if (expected.screenSignature !== undefined && expected.screenSignature !== snapshot.screenSignature)
          return false
        if (expected.textContains !== undefined) {
          const haystack = snapshot.nodes.map((node) => `${node.text || ''} ${node.contentDescription || ''}`).join(' ')
          if (!haystack.includes(String(expected.textContains))) return false
        }
      }
      return true
    },
  }
}

/**
 * Resolve and run a confirmed recipe without involving a model.  Storage and
 * the App Index are injected so this path is deterministic and testable on a
 * desktop runner as well as on Android.
 */
export async function tryRunStoredAndroidRecipe(
  goalInput: GoalSpec | string,
  options: StoredRecipeAttemptOptions,
): Promise<StoredRecipeAttempt> {
  const goal =
    typeof goalInput === 'string'
      ? GoalSpecSchema.parse({
          objective: goalInput.slice(0, 4_096),
          constraints: {
            maxLocalActions: 20,
            maxCommits: 1,
            maxModelRequests: 3,
            maxReplans: 1,
            requireVerification: true,
          },
        })
      : goalInput
  let storage = options.storage
  if (!storage) {
    try {
      const module = await import('@/platform')
      storage = module.default
    } catch {
      return { matched: false, match: { kind: 'not_found', candidates: [] }, reason: 'storage_unavailable' }
    }
  }
  let recipes: AndroidRecipeDescriptor[]
  try {
    recipes = await new AndroidRecipeStore(storage).list()
  } catch {
    return { matched: false, match: { kind: 'not_found', candidates: [] }, reason: 'storage_unavailable' }
  }
  const matcher = new AndroidRecipeMatcher(options.appIndex || createAndroidAppIndex())
  const match = await matcher.match(goal, recipes, { backend: options.backend })
  if (match.kind !== 'matched' || !match.recipe) {
    return {
      matched: false,
      match,
      reason: match.kind === 'ambiguous' ? 'ambiguous' : 'not_found',
    }
  }
  if (match.recipe.risk !== 'read') {
    const confirmed = await options.confirm?.(match.recipe)
    if (!confirmed) return { matched: true, match, reason: 'confirmation_required' }
  }
  const result = await new AndroidRecipeRunner(options.host).run(match.recipe, options, match.app)
  return { matched: true, match, result }
}
