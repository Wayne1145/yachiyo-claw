import { Device } from '@capacitor/device'
import { SEMANTIC_NODE_ROLES, type JsonValue } from '@shared/agent'
import { type ToolExecutionOptions, tool } from 'ai'
import { z } from 'zod'
import { requestAgentApproval } from '@/mobile/agent-approval'
import {
  type AgentBrokerCallContext,
  executeAccessibilityAction,
  executeAppLaunch,
  executeCompanionAction,
  executeRootShell,
  getAgentBackend,
} from '@/mobile/agent-broker'
import { createAndroidAppIndex, type LaunchableApp } from '@/mobile/android-app-index'
import {
  AndroidRecipeRunner,
  AndroidRecipeStore,
  createDefaultRecipeHost,
  type AndroidRecipeDescriptor,
} from '@/mobile/android-recipes'
import { createLocalAppLauncher } from '@/mobile/local-app-launcher'
import { projectAgentResult } from '@/mobile/agent-result-policy'
import { compactSemanticObservation, yachiyoDeviceAccessNative } from '@/platform/native/yachiyo_device_access'

type DeviceOperationListener = () => void | Promise<void>
const operationListeners = new Set<DeviceOperationListener>()

export function onAndroidDeviceOperation(listener: DeviceOperationListener): () => void {
  operationListeners.add(listener)
  return () => operationListeners.delete(listener)
}

async function notifyDeviceOperation(): Promise<void> {
  await Promise.all([...operationListeners].map((listener) => listener()))
}

type AndroidToolContext = ToolExecutionOptions

function brokerContext(sessionId: string | undefined, context?: AndroidToolContext): AgentBrokerCallContext {
  return {
    taskId: sessionId,
    toolCallId: context?.toolCallId,
    abortSignal: context?.abortSignal,
  }
}

async function exec(
  command: string,
  timeout = 30_000,
  sessionId?: string,
  context?: AndroidToolContext,
  sideEffect = true,
) {
  await notifyDeviceOperation()
  return projectAgentResult(
    await executeRootShell(command, timeout, { ...brokerContext(sessionId, context), sideEffect }),
  )
}

async function accessibility(
  options: Parameters<typeof yachiyoDeviceAccessNative.accessibilityAction>[0],
  sessionId?: string,
  context?: AndroidToolContext,
) {
  await notifyDeviceOperation()
  const result = await executeAccessibilityAction(options, brokerContext(sessionId, context))
  const output =
    options.action === 'observeSemantic' && result.output
      ? compactSemanticObservation(result.output, sessionId || 'android-agent')
      : result.output
  return projectAgentResult({
    stdout: output || (result.success ? 'ok' : ''),
    stderr: result.success ? '' : result.reason || 'accessibility_action_failed',
    exitCode: result.success ? 0 : 1,
    ...(result.method ? { method: result.method } : {}),
    ...(result.node ? { node: result.node } : {}),
    ...(result.found !== undefined ? { found: result.found } : {}),
    ...(result.bytes !== undefined ? { bytes: result.bytes } : {}),
  })
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const companionString = (max: number) => z.string().trim().min(1).max(max)
const companionSelectorSchema = z
  .object({
    packageName: companionString(200).optional(),
    resourceId: companionString(300).optional(),
    text: companionString(500).optional(),
    contentDescription: companionString(500).optional(),
    role: companionString(80).optional(),
    ancestorSignature: companionString(500).optional(),
  })
  .strict()
  .refine((selector) => Object.values(selector).some((value) => value !== undefined), {
    message: 'selector_requires_at_least_one_field',
  })

const companionJsonSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string().max(4_000),
    z.array(companionJsonSchema).max(100),
    z.record(z.string().max(100), companionJsonSchema),
  ]),
)

const companionActionSchema = z.discriminatedUnion('capability', [
  z
    .object({
      capability: z.literal('observe'),
      parameters: z
        .object({ packageName: companionString(200).optional() })
        .strict()
        .default({}),
    })
    .strict(),
  z
    .object({ capability: z.literal('find'), parameters: z.object({ selector: companionSelectorSchema }).strict() })
    .strict(),
  z
    .object({ capability: z.literal('click'), parameters: z.object({ selector: companionSelectorSchema }).strict() })
    .strict(),
  z
    .object({
      capability: z.literal('setText'),
      parameters: z.object({ selector: companionSelectorSchema, text: z.string().max(4_000) }).strict(),
    })
    .strict(),
  z
    .object({
      capability: z.literal('scroll'),
      parameters: z
        .object({
          selector: companionSelectorSchema,
          direction: z.enum(['up', 'down', 'left', 'right', 'forward', 'backward']),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      capability: z.literal('launch'),
      parameters: z
        .object({
          packageName: companionString(256).regex(/^[a-zA-Z0-9_.]+$/),
          activityName: companionString(300).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      capability: z.literal('verify'),
      parameters: z
        .object({
          expected: companionJsonSchema.optional(),
          selector: companionSelectorSchema.optional(),
          packageName: companionString(200).optional(),
        })
        .strict()
        .refine((parameters) => Object.values(parameters).some((value) => value !== undefined), {
          message: 'verify_requires_expected_selector_or_package',
        }),
    })
    .strict(),
])

type CompanionAction = z.infer<typeof companionActionSchema>

function companionApprovalDetail(action: CompanionAction): string {
  const redact = (value: unknown, key = ''): unknown => {
    if (key === 'text' && action.capability === 'setText' && typeof value === 'string') {
      return `[redacted ${value.length} chars]`
    }
    if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 160)}...` : value
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .slice(0, 20)
          .map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]),
      )
    }
    return value
  }
  const detail = JSON.stringify({ capability: action.capability, parameters: redact(action.parameters) })
  return detail.length > 1_000 ? `${detail.slice(0, 1_000)}...` : detail
}

export function createAndroidDeviceToolSet(sessionId?: string, approvalSessionId?: string) {
  const appIndex = createAndroidAppIndex()
  const localAppLauncher = createLocalAppLauncher({ onOperation: notifyDeviceOperation })
  // Once local app launch has failed, launcher navigation is no longer a valid
  // model fallback.  The local launcher owns search and placement recovery.
  let appLaunchFailed = false
  const blockedLauncherExploration = () => ({
    stdout: '',
    stderr: 'launcher_search_is_local_only',
    exitCode: 2,
  })
  const description = `
You can control the Android device through structured tools.
Observe the current UI before acting, prefer semantic node selectors over coordinates,
and observe again after each action. Use android_launch_app for apps; never use HOME and repeated swipes to search launcher pages.
${
  getAgentBackend() === 'accessibility'
    ? 'This backend uses AccessibilityService gestures and does not provide a shell.'
    : 'A privileged shell is available for advanced Android commands.'
}
`
  const approve = (
    title: string,
    detail: string,
    risk: 'safe' | 'dangerous' = 'safe',
    context?: AndroidToolContext,
  ) =>
    requestAgentApproval({
      sessionId: approvalSessionId || sessionId,
      runId: sessionId,
      title,
      detail,
      risk,
      signal: context?.abortSignal,
    })
  const denied = () => ({ stdout: '', stderr: '用户拒绝了此操作', exitCode: 126 })

  const android_device_info = tool({
    description:
      'Read basic information about this Android device, including manufacturer, model, Android version, SDK version, and whether it is virtual. This is read-only and does not require approval.',
    inputSchema: z.object({}),
    execute: async () => {
      const info = await Device.getInfo()
      return {
        platform: info.platform,
        manufacturer: info.manufacturer,
        model: info.model,
        name: info.name,
        operatingSystem: info.operatingSystem,
        osVersion: info.osVersion,
        androidSdkVersion: info.androidSDKVersion,
        isVirtual: info.isVirtual,
        webViewVersion: info.webViewVersion,
      }
    },
  })

  const android_permission_status = tool({
    description: 'Read the current Yachiyo Claw Android permission and backend status. This is read-only.',
    inputSchema: z.object({}),
    execute: async () => {
      const native = yachiyoDeviceAccessNative as typeof yachiyoDeviceAccessNative & {
        getPermissionStatus?: () => Promise<unknown>
      }
      if (!native.getPermissionStatus) return { available: false, reason: 'permission_status_unavailable' }
      return native.getPermissionStatus()
    },
  })

  const android_app_list = tool({
    description: 'List launchable applications using the native package manager bridge. This is read-only.',
    inputSchema: z.object({}),
    execute: async () => {
      const result = await yachiyoDeviceAccessNative.listLaunchableApps()
      return { apps: result.apps, count: result.count, observedAt: result.observedAt }
    },
  })

  const android_storage_status = tool({
    description: 'Read WebView-visible storage quota and usage estimates. This is read-only and may be approximate.',
    inputSchema: z.object({}),
    execute: async () => {
      const estimate = await navigator.storage?.estimate?.()
      return {
        usageBytes: estimate?.usage ?? null,
        quotaBytes: estimate?.quota ?? null,
        supported: Boolean(estimate),
      }
    },
  })

  const android_network_status = tool({
    description:
      'Read the current network reachability hint exposed by Android WebView. This is not a connectivity guarantee.',
    inputSchema: z.object({}),
    execute: async () => {
      const connection = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } })
        .connection
      return {
        online: navigator.onLine,
        effectiveType: connection?.effectiveType,
        downlinkMbps: connection?.downlink,
      }
    },
  })

  const android_launcher_context = tool({
    description: 'Read launcher grid and display context for deterministic app placement tasks. This is read-only.',
    inputSchema: z.object({}),
    execute: async () => {
      const native = yachiyoDeviceAccessNative as typeof yachiyoDeviceAccessNative & {
        getLauncherContext?: () => Promise<unknown>
      }
      if (!native.getLauncherContext) return { available: false, reason: 'launcher_context_unavailable' }
      return native.getLauncherContext()
    },
  })

  const android_observe = tool({
    description:
      "Read a compact, redacted semantic snapshot of the current Android UI. The first result is full; a later mode='diff' result applies to baseSignature and removes removedNodeIds. Prefer node selectors over coordinates.",
    inputSchema: z.object({}),
    execute: async (_input, context) =>
      getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'observeSemantic' }, sessionId, context as AndroidToolContext)
        : exec(
            'uiautomator dump /data/local/tmp/yachiyo-window.xml >/dev/null 2>&1; head -c 16384 /data/local/tmp/yachiyo-window.xml; echo; dumpsys window | grep -E "mCurrentFocus|mFocusedApp"',
            30_000,
            sessionId,
            context as AndroidToolContext,
            false,
          ),
  })

  const nodeSelectorBaseSchema = z.object({
    package_name: z.string().max(200).optional(),
    resource_id: z.string().max(300).optional(),
    text: z.string().max(500).optional(),
    content_description: z.string().max(500).optional(),
    role: z.enum(SEMANTIC_NODE_ROLES).optional(),
    ancestor_signature: z.string().max(500).optional(),
  })
  const nodeSelectorSchema = nodeSelectorBaseSchema.refine(
    (selector) => Object.values(selector).some((value) => value !== undefined),
    {
      message: '至少提供一个节点选择条件',
    },
  )

  const selectorInput = (selector: z.infer<typeof nodeSelectorBaseSchema>) => ({
    packageName: selector.package_name,
    resourceId: selector.resource_id,
    text: selector.text,
    contentDescription: selector.content_description,
    role: selector.role,
    ancestorSignature: selector.ancestor_signature,
  })

  const android_find_node = tool({
    description: 'Find one visible Accessibility node using a semantic selector. This is read-only.',
    inputSchema: nodeSelectorSchema,
    execute: async (selector, context) =>
      getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'findNode', ...selectorInput(selector) }, sessionId, context as AndroidToolContext)
        : { stdout: '', stderr: 'semantic_nodes_require_accessibility_backend', exitCode: 2 },
  })

  const android_click_node = tool({
    description: 'Click a freshly resolved semantic Accessibility node instead of using a coordinate.',
    inputSchema: nodeSelectorSchema,
    execute: async (selector, context) => {
      if (!(await approve('点击界面元素', JSON.stringify(selector), 'dangerous', context as AndroidToolContext))) {
        return denied()
      }
      return getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'clickNode', ...selectorInput(selector) }, sessionId, context as AndroidToolContext)
        : { stdout: '', stderr: 'semantic_nodes_require_accessibility_backend', exitCode: 2 }
    },
  })

  const android_set_node_text = tool({
    description: 'Set text in a freshly resolved semantic Accessibility input node.',
    inputSchema: nodeSelectorBaseSchema
      .extend({ text_value: z.string().max(4_000) })
      .refine(
        ({ text_value, ...selector }) =>
          text_value !== undefined && Object.values(selector).some((value) => value !== undefined),
        {
          message: '至少提供一个节点选择条件',
        },
      ),
    execute: async ({ text_value, ...selector }, context) => {
      const preview = text_value.length > 160 ? `${text_value.slice(0, 160)}…` : text_value
      if (!(await approve('输入文字', preview, 'dangerous', context as AndroidToolContext))) return denied()
      return getAgentBackend() === 'accessibility'
        ? accessibility(
            {
              action: 'setNodeText',
              ...selectorInput(selector),
              selectorText: selector.text,
              text: text_value,
            },
            sessionId,
            context as AndroidToolContext,
          )
        : { stdout: '', stderr: 'semantic_nodes_require_accessibility_backend', exitCode: 2 }
    },
  })

  const android_scroll_node = tool({
    description: 'Scroll a semantic Accessibility container by direction.',
    inputSchema: nodeSelectorBaseSchema
      .extend({ direction: z.enum(['up', 'down', 'left', 'right', 'forward', 'backward']) })
      .refine(
        ({ direction: _direction, ...selector }) => Object.values(selector).some((value) => value !== undefined),
        {
          message: '至少提供一个节点选择条件',
        },
      ),
    execute: async ({ direction, ...selector }, context) => {
      const parameters = { selector: selectorInput(selector), direction }
      if (!(await approve('滚动界面元素', JSON.stringify(parameters), 'dangerous', context as AndroidToolContext))) {
        return denied()
      }
      return getAgentBackend() === 'accessibility'
        ? accessibility(
            { action: 'scrollNode', ...parameters.selector, direction: parameters.direction },
            sessionId,
            context as AndroidToolContext,
          )
        : { stdout: '', stderr: 'semantic_nodes_require_accessibility_backend', exitCode: 2 }
    },
  })

  const android_tap = tool({
    description: 'Tap a physical screen coordinate.',
    inputSchema: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
    execute: async ({ x, y }, context) => {
      if (!(await approve('点击屏幕', `坐标：(${x}, ${y})`, 'dangerous', context as AndroidToolContext))) {
        return denied()
      }
      return getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'tap', x, y }, sessionId, context as AndroidToolContext)
        : exec(`input tap ${x} ${y}`, 30_000, sessionId, context as AndroidToolContext)
    },
  })

  const android_swipe = tool({
    description: 'Swipe between physical screen coordinates.',
    inputSchema: z.object({
      start_x: z.number().int().nonnegative(),
      start_y: z.number().int().nonnegative(),
      end_x: z.number().int().nonnegative(),
      end_y: z.number().int().nonnegative(),
      duration_ms: z.number().int().min(50).max(5_000).optional(),
    }),
    execute: async ({ start_x, start_y, end_x, end_y, duration_ms }, context) => {
      if (getAgentBackend() === 'accessibility' && appLaunchFailed) return blockedLauncherExploration()
      if (!(await approve('滑动屏幕', `(${start_x}, ${start_y}) → (${end_x}, ${end_y})`, 'safe', context as AndroidToolContext))) {
        return denied()
      }
      return getAgentBackend() === 'accessibility'
        ? accessibility(
            {
              action: 'swipe',
              startX: start_x,
              startY: start_y,
              endX: end_x,
              endY: end_y,
              duration: duration_ms ?? 350,
            },
            sessionId,
            context as AndroidToolContext,
          )
        : exec(
            `input swipe ${start_x} ${start_y} ${end_x} ${end_y} ${duration_ms ?? 350}`,
            30_000,
            sessionId,
            context as AndroidToolContext,
          )
    },
  })

  const android_type_text = tool({
    description: 'Type text into the currently focused Android input.',
    inputSchema: z.object({ text: z.string().max(4_000) }),
    execute: async ({ text }, context) => {
      const preview = text.length > 160 ? `${text.slice(0, 160)}…` : text
      if (!(await approve('输入文字', preview, 'dangerous', context as AndroidToolContext))) return denied()
      return getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'text', text }, sessionId, context as AndroidToolContext)
        : exec(`input text ${shellQuote(text.replace(/ /g, '%s'))}`, 30_000, sessionId, context as AndroidToolContext)
    },
  })

  const android_keyevent = tool({
    description: 'Send an Android system navigation action such as HOME, BACK, or RECENTS.',
    inputSchema: z.object({ key: z.union([z.string().max(40), z.number().int().nonnegative()]) }),
    execute: async ({ key }, context) => {
      const normalizedKey = String(key).toUpperCase()
      if (getAgentBackend() === 'accessibility' && appLaunchFailed && ['HOME', 'RECENTS'].includes(normalizedKey)) {
        return blockedLauncherExploration()
      }
      if (!(await approve('执行系统导航', String(key), 'dangerous', context as AndroidToolContext))) return denied()
      return getAgentBackend() === 'accessibility'
        ? accessibility({ action: 'global', key: String(key) }, sessionId, context as AndroidToolContext)
        : exec(`input keyevent ${shellQuote(String(key))}`, 30_000, sessionId, context as AndroidToolContext)
    },
  })

  const android_launch_app = tool({
    description:
      'Launch an installed Android app by package name or a locally resolved app name. App lookup never uses the model or launcher swipes.',
    inputSchema: z
      .object({
        package_name: z
          .string()
          .regex(/^[a-zA-Z0-9_.]+$/)
          .optional(),
        app_name: z.string().trim().min(1).max(200).optional(),
      })
      .refine((value) => Boolean(value.package_name || value.app_name), {
        message: 'package_name or app_name is required',
      }),
    execute: async ({ package_name, app_name }, context) => {
      let resolvedPackage = package_name
      let resolvedLabel = package_name
      let resolvedActivity: string | undefined
      let launchableApp: LaunchableApp | undefined
      if (!resolvedPackage && app_name) {
        const resolution = await appIndex.resolve(app_name)
        if (resolution.kind !== 'resolved') {
          return {
            stdout: JSON.stringify({ query: app_name, kind: resolution.kind, candidates: resolution.candidates }),
            stderr: resolution.kind === 'ambiguous' ? 'app_resolution_ambiguous' : 'app_not_found',
            exitCode: 2,
          }
        }
        resolvedPackage = resolution.app.packageName
        resolvedLabel = resolution.app.label
        resolvedActivity = resolution.app.launchActivity || resolution.app.activityName
        launchableApp = resolution.app
      }
      if (!resolvedPackage) return { stdout: '', stderr: 'app_not_found', exitCode: 2 }
      launchableApp ||= {
        packageName: resolvedPackage,
        label: resolvedLabel || resolvedPackage,
        ...(resolvedActivity ? { launchActivity: resolvedActivity, activityName: resolvedActivity } : {}),
      }
      if (
        !(await approve(
          '启动应用',
          `${resolvedLabel || resolvedPackage} (${resolvedPackage})`,
          'dangerous',
          context as AndroidToolContext,
        ))
      ) {
        return denied()
      }
      appLaunchFailed = false
      const launch =
        getAgentBackend() === 'accessibility'
          ? await localAppLauncher.launch(launchableApp, brokerContext(sessionId, context as AndroidToolContext))
          : await (async () => {
              await notifyDeviceOperation()
              return executeAppLaunch(
                resolvedPackage,
                resolvedActivity,
                brokerContext(sessionId, context as AndroidToolContext),
              )
            })()
      appLaunchFailed = !launch.success
      return {
        stdout: launch.output || (launch.success ? 'ok' : ''),
        stderr: launch.success
          ? ''
          : (launch as { error?: string; reason?: string }).error ||
            (launch as { error?: string; reason?: string }).reason ||
            'app_launch_failed',
        exitCode: launch.success ? 0 : 1,
      }
    },
  })

  // The model receives only an opaque recipe id. Recipe steps stay local and
  // are executed through the same Broker host as hand-authored actions.
  const android_run_recipe = tool({
    description: 'Run one previously confirmed local Android recipe by id. The recipe body is never sent to the model.',
    inputSchema: z.object({ recipe_id: z.string().trim().min(1).max(128) }),
    execute: async ({ recipe_id }, context) => {
      const storage = (await import('@/platform')).default
      const recipe = (await new AndroidRecipeStore(storage).list()).find((item) => item.id === recipe_id)
      if (!recipe) return { stdout: '', stderr: 'recipe_not_found', exitCode: 2 }
      if (
        recipe.risk !== 'read' &&
        !(await approve('运行已确认的设备流程', recipe.id, 'dangerous', context as AndroidToolContext))
      ) {
        return denied()
      }
      const result = await new AndroidRecipeRunner(createDefaultRecipeHost()).run(recipe, {
        taskId: sessionId || 'android-agent',
        abortSignal: (context as AndroidToolContext).abortSignal,
        host: createDefaultRecipeHost(),
      })
      return {
        stdout: JSON.stringify({
          status: result.status,
          stepIndex: result.stepIndex,
          summary: result.summary,
          digest: result.digest,
        }),
        stderr: result.status === 'failed' ? result.summary : '',
        exitCode: result.status === 'failed' ? 1 : 0,
      }
    },
  })

  const android_companion_action = tool({
    description:
      'Use an explicitly configured Android companion for one canonical fallback action after semantic controls fail.',
    inputSchema: companionActionSchema,
    execute: async (input, context) => {
      // Validate again at execution so non-model callers cannot smuggle
      // protocol-specific or unapproved parameters into the companion.
      const action = companionActionSchema.parse(input)
      const { capability, parameters } = action
      const mutating = !['observe', 'find', 'verify'].includes(capability)
      if (
        mutating &&
        !(await approve(
          '执行伴侣设备操作',
          companionApprovalDetail(action),
          'dangerous',
          context as AndroidToolContext,
        ))
      ) {
        return denied()
      }
      await notifyDeviceOperation()
      const result = await executeCompanionAction(
        capability,
        parameters as JsonValue,
        brokerContext(sessionId, context as AndroidToolContext),
      )
      return {
        stdout: JSON.stringify({
          success: result.success,
          data: result.data,
          fallbackToNative: result.fallbackToNative,
          responseBytes: result.responseBytes,
        }),
        stderr: result.success ? '' : result.error?.code || 'companion_action_failed',
        exitCode: result.success ? 0 : 1,
      }
    },
  })

  return {
    description,
    tools: {
      android_device_info,
      android_permission_status,
      android_app_list,
      android_storage_status,
      android_network_status,
      android_launcher_context,
      android_observe,
      android_find_node,
      android_click_node,
      android_set_node_text,
      android_scroll_node,
      android_tap,
      android_swipe,
      android_type_text,
      android_keyevent,
      android_launch_app,
      android_run_recipe,
      android_companion_action,
    },
  }
}

export default createAndroidDeviceToolSet()
