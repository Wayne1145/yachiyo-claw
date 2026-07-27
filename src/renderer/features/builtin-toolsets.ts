import { type ToolExecutionOptions, type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { ANDROID_TOOL_STAGE_INITIAL } from '@shared/agent/android-tool-stages'
import type { KnowledgeBase, Message } from '@shared/types'
import type { SkillInfo } from '@shared/types/skills'
import { createCameraCaptureTool } from '@/mobile/camera-tool'
import { mcpController } from '@/packages/mcp/controller'
import { createAndroidDeviceToolSet } from '@/packages/model-calls/toolsets/android-device'
import fileToolSet from '@/packages/model-calls/toolsets/file'
import { getToolSet as getKBToolSet } from '@/packages/model-calls/toolsets/knowledge-base'
import { createLongTermMemoryToolSet } from '@/packages/model-calls/toolsets/long-term-memory'
import sandboxToolSet from '@/packages/model-calls/toolsets/sandbox'
import { getToolSet as getSessionAttachmentRagToolSet } from '@/packages/model-calls/toolsets/session-attachment-rag'
import { getToolSetDescription, parseLinkTool, webSearchTool } from '@/packages/model-calls/toolsets/web-search'
import workspaceBrowserToolSet from '@/packages/model-calls/toolsets/workspace-browser'
import { createWorkspaceAgentToolSet } from '@/packages/model-calls/toolsets/workspace-agent'
import { PROVIDERS_WITH_PARSE_LINK } from '@/packages/web-search'
import { skillsController } from '@/packages/skills/controller'
import { generateSkillsXml } from '@/stores/session/skills-xml'
import * as settingActions from '@/stores/settingActions'
import type { FeatureToolsetFactory, ToolsetContext } from './toolset-contract'
import { hasFeatureToolset, registerFeatureToolset } from './toolset-registry'

/**
 * Faithful `FeatureToolsetFactory` adapters for every built-in toolset (migration-02 phase 2).
 *
 * These wrap the existing toolset exports with byte-identical behaviour, enablement conditions, and —
 * critically — the same instruction concatenation order as `buildToolsForSession`. Registration order
 * below reproduces that order. `buildToolsForSession` is NOT switched over yet; the equivalence test
 * proves this registry is a drop-in replacement before any switchover.
 */

interface FeatureOptionsBag {
  'web-search'?: { webBrowsing?: boolean }
  'knowledge-base'?: { knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'> }
  sandbox?: { sandboxEnabled?: boolean }
  workspace?: { sandboxEnabled?: boolean }
  'android-device'?: { deviceControlEnabled?: boolean }
  camera?: { cameraSessionId?: string }
  skills?: { enabledSkillNames?: string[]; sandboxEnabled?: boolean }
  mcp?: { agentSessionId?: string }
}

function options<K extends keyof FeatureOptionsBag>(context: ToolsetContext, id: K): FeatureOptionsBag[K] {
  return context.featureOptions[id] as FeatureOptionsBag[K]
}

function hasInlineFileOrLink(messages: readonly Message[]): boolean {
  return messages.some((m) => m.links?.length || m.files?.some((file) => file.ragMode !== 'session-retrieval'))
}

function sessionAttachmentRagIds(messages: readonly Message[]): number[] {
  return Array.from(
    new Set(
      messages.flatMap((message) =>
        (message.files ?? [])
          .filter(
            (file) =>
              file.ragMode === 'session-retrieval' &&
              file.sessionAttachmentAvailability !== 'blocked' &&
              typeof file.sessionAttachmentId === 'number',
          )
          .map((file) => file.sessionAttachmentId as number),
      ),
    ),
  )
}

const mcpFactory: FeatureToolsetFactory = async (context) => {
  const tools = { ...mcpController.getAvailableTools(options(context, 'mcp')?.agentSessionId) }
  return { instructions: '', tools }
}

const knowledgeBaseFactory: FeatureToolsetFactory = async (context) => {
  const knowledgeBase = options(context, 'knowledge-base')?.knowledgeBase
  if (!knowledgeBase || !context.model.isSupportToolUse('knowledge-base')) return null
  try {
    const set = await getKBToolSet(knowledgeBase.id, knowledgeBase.name)
    return { instructions: set.description, tools: set.tools }
  } catch (error) {
    console.error('Failed to load knowledge base toolset:', error)
    return null
  }
}

const sessionRagFactory: FeatureToolsetFactory = async (context) => {
  const ids = sessionAttachmentRagIds(context.messages)
  if (ids.length === 0 || !context.model.isSupportToolUse('read-file')) return null
  try {
    const set = await getSessionAttachmentRagToolSet(ids)
    return { instructions: set.description, tools: set.tools }
  } catch (error) {
    console.error('Failed to load session attachment RAG toolset:', error)
    return null
  }
}

const fileFactory: FeatureToolsetFactory = async (context) => {
  if (!hasInlineFileOrLink(context.messages) || !context.model.isSupportToolUse('read-file')) return null
  return { instructions: fileToolSet.description, tools: fileToolSet.tools }
}

const webSearchFactory: FeatureToolsetFactory = async (context) => {
  const webBrowsing = Boolean(options(context, 'web-search')?.webBrowsing)
  if (!webBrowsing || !context.model.isSupportToolUse('web-browsing')) return null
  const provider = settingActions.getExtensionSettings().webSearch.provider
  const includeParseLink = PROVIDERS_WITH_PARSE_LINK.has(provider)
  const tools: ToolSet = { web_search: webSearchTool }
  if (includeParseLink) tools.parse_link = parseLinkTool
  return { instructions: getToolSetDescription({ includeParseLink }), tools }
}

const sandboxFactory: FeatureToolsetFactory = async (context) => {
  if (!options(context, 'sandbox')?.sandboxEnabled) return null
  return { instructions: sandboxToolSet.description, tools: { ...sandboxToolSet.tools } }
}

const workspaceFactory: FeatureToolsetFactory = async (context) => {
  if (context.platformType !== 'mobile' || !options(context, 'workspace')?.sandboxEnabled) return null
  const structured = createWorkspaceAgentToolSet(context.approvalSessionId || context.agentRunId)
  return {
    instructions: workspaceBrowserToolSet.description + structured.description,
    tools: { ...workspaceBrowserToolSet.tools, ...structured.tools },
  }
}

const androidDeviceFactory: FeatureToolsetFactory = async (context) => {
  if (!options(context, 'android-device')?.deviceControlEnabled || context.platformType !== 'mobile') return null
  const set = createAndroidDeviceToolSet(context.agentRunId, context.approvalSessionId)
  return { instructions: set.description, tools: set.tools, initialActiveTools: ANDROID_TOOL_STAGE_INITIAL }
}

const longTermMemoryFactory: FeatureToolsetFactory = async (context) => {
  if (!context.model.isSupportToolUse()) return null
  const set = createLongTermMemoryToolSet(context.approvalSessionId || context.agentRunId)
  return { instructions: set.description, tools: set.tools }
}

const cameraFactory: FeatureToolsetFactory = async (context) => {
  const cameraSessionId = options(context, 'camera')?.cameraSessionId
  if (!context.model.isSupportToolUse() || !cameraSessionId) return null
  // createCameraCaptureTool returns undefined when no capture provider is registered; the original
  // guards on that before adding the tool or its instructions, so this contributes nothing then.
  const cameraCaptureTool = createCameraCaptureTool(cameraSessionId)
  if (!cameraCaptureTool) return null
  return {
    instructions:
      '\n<camera_capture>The interactive camera preview is active. Use camera_capture when a fresh visual observation is needed.</camera_capture>\n',
    tools: { camera_capture: cameraCaptureTool },
  }
}

const skillsFactory: FeatureToolsetFactory = async (context) => {
  const config = options(context, 'skills')
  const enabledSkillNames = config?.enabledSkillNames
  const canWriteSkill = context.platformType === 'mobile' && Boolean(config?.sandboxEnabled)
  if ((!enabledSkillNames || enabledSkillNames.length === 0) && !canWriteSkill) return null
  let allSkills: SkillInfo[] = []
  if (enabledSkillNames?.length) {
    try {
      allSkills = await skillsController.discoverSkills()
    } catch (error) {
      console.error('Failed to discover skills:', error)
    }
  }
  const enabledSkills = allSkills.filter((s) => enabledSkillNames?.includes(s.name))

  let instructions = enabledSkills.length > 0 ? generateSkillsXml(enabledSkills, context.model.isSupportToolUse()) : ''
  const tools: ToolSet = {}
  if (context.model.isSupportToolUse()) {
    if (enabledSkills.length > 0) {
      tools.load_skill = tool({
        description:
          "Load the full instructions of a skill by name. Call this when a task matches a skill's description from the available_skills list.",
        inputSchema: z.object({ name: z.string().describe('The name of the skill to load') }),
        execute: async (input: { name: string }) => {
          if (!enabledSkillNames?.includes(input.name))
            return { error: `Skill "${input.name}" is not enabled for this session.` }
          const result = await skillsController.loadSkill(input.name)
          if (!result) return { error: `Skill "${input.name}" not found or could not be loaded.` }
          return { instructions: result.body }
        },
      })
    }
    const scriptExecutionAvailable =
      context.platformType !== 'mobile' ||
      (Boolean(config?.sandboxEnabled) && enabledSkills.some((skill) => skill.scriptExecutionEnabled))
    if (scriptExecutionAvailable) {
      tools.execute_skill_script = tool({
        description:
          "Execute a script from a skill's scripts directory. Use when a loaded skill references executable scripts.",
        inputSchema: z.object({
          skill_name: z.string().describe('The name of the skill'),
          script_name: z.string().describe('The script filename to execute'),
          arguments: z.array(z.string()).optional().describe('Optional arguments to pass to the script'),
        }),
        execute: async (
          input: { skill_name: string; script_name: string; arguments?: string[] },
          executionContext: ToolExecutionOptions,
        ) => {
          if (!enabledSkillNames?.includes(input.skill_name)) {
            return { success: false, stdout: '', stderr: `Skill "${input.skill_name}" is not enabled.`, exitCode: null }
          }
          return skillsController.executeScript(input.skill_name, input.script_name, input.arguments, {
            sessionId: context.approvalSessionId || context.agentRunId,
            toolCallId: executionContext.toolCallId,
            abortSignal: executionContext.abortSignal,
          })
        },
      })
    }
    if (canWriteSkill) {
      instructions +=
        '\n<skill_authoring>Use write_skill only when the user asks to preserve a reusable workflow or when a stable repeated procedure is clearly worth saving.</skill_authoring>\n'
      tools.write_skill = tool({
        description: 'Create or update a reusable local Agent skill on this Android device.',
        inputSchema: z.object({
          name: z
            .string()
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
            .max(64),
          description: z.string().min(1).max(1024),
          instructions: z.string().min(1).max(20_000),
        }),
        execute: ({ name, description, instructions: body }) =>
          skillsController.saveSkill({ name, description }, body),
      })
    }
  }
  return { instructions, tools }
}

// Registration order reproduces buildToolsForSession's instruction concatenation order. mcp contributes
// no instructions, so it goes first as the tool base.
const BUILTIN_TOOLSETS: Array<[string, FeatureToolsetFactory]> = [
  ['mcp', mcpFactory],
  ['knowledge-base', knowledgeBaseFactory],
  ['session-attachment-rag', sessionRagFactory],
  ['file', fileFactory],
  ['web-search', webSearchFactory],
  ['sandbox', sandboxFactory],
  ['workspace', workspaceFactory],
  ['android-device', androidDeviceFactory],
  ['long-term-memory', longTermMemoryFactory],
  ['camera', cameraFactory],
  ['skills', skillsFactory],
]

export function registerBuiltinToolsets(): void {
  for (const [id, factory] of BUILTIN_TOOLSETS) {
    if (!hasFeatureToolset(id)) registerFeatureToolset(id, factory)
  }
}

/** Builds a ToolsetContext from the legacy BuildToolsOptions shape (compat bridge for the switchover). */
export function toolsetContextFromLegacyOptions(
  model: ToolsetContext['model'],
  options: {
    webBrowsing?: boolean
    knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
    messages: Message[]
    sandboxEnabled?: boolean
    enabledSkillNames?: string[]
    agentSessionId?: string
    agentApprovalSessionId?: string
    cameraSessionId?: string
    deviceControlEnabled?: boolean
    featureOptions?: Readonly<Record<string, unknown>>
  },
  platformType: string,
  enabledFeatureIds?: ReadonlySet<string>,
): ToolsetContext {
  return {
    model,
    messages: options.messages,
    platformType,
    agentRunId: options.agentSessionId,
    approvalSessionId: options.agentApprovalSessionId,
    enabledFeatureIds,
    featureOptions: {
      'web-search': { webBrowsing: options.webBrowsing },
      'knowledge-base': { knowledgeBase: options.knowledgeBase },
      sandbox: { sandboxEnabled: options.sandboxEnabled },
      workspace: { sandboxEnabled: options.sandboxEnabled },
      'android-device': { deviceControlEnabled: options.deviceControlEnabled },
      camera: { cameraSessionId: options.cameraSessionId },
      skills: { enabledSkillNames: options.enabledSkillNames, sandboxEnabled: options.sandboxEnabled },
      mcp: { agentSessionId: options.agentSessionId },
      ...options.featureOptions,
    },
  }
}
