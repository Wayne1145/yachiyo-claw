import type { ModelInterface } from '@shared/models/types'
import type { KnowledgeBase, Message } from '@shared/types'
import type { SkillInfo } from '@shared/types/skills'
import { type ToolExecutionOptions, type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { ANDROID_TOOL_STAGE_INITIAL } from '@shared/agent/android-tool-stages'
import { createCameraCaptureTool } from '@/mobile/camera-tool'
import { mcpController } from '@/packages/mcp/controller'
import { createAndroidDeviceToolSet } from '@/packages/model-calls/toolsets/android-device'
import fileToolSet from '@/packages/model-calls/toolsets/file'
import { getToolSet as getKBToolSet } from '@/packages/model-calls/toolsets/knowledge-base'
import { createLongTermMemoryToolSet } from '@/packages/model-calls/toolsets/long-term-memory'
import sandboxToolSet from '@/packages/model-calls/toolsets/sandbox'
import { getToolSet as getSessionAttachmentRagToolSet } from '@/packages/model-calls/toolsets/session-attachment-rag'
import { getToolSetDescription, parseLinkTool, webSearchTool } from '@/packages/model-calls/toolsets/web-search'
import { skillsController } from '@/packages/skills/controller'
import { PROVIDERS_WITH_PARSE_LINK } from '@/packages/web-search'
import platform from '@/platform'
import * as settingActions from '@/stores/settingActions'

export interface BuildToolsOptions {
  webBrowsing: boolean
  knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
  messages: Message[]
  sandboxEnabled?: boolean
  enabledSkillNames?: string[]
  /** Generated run id used by Broker checkpoints and precise cancellation. */
  agentSessionId?: string
  /** Conversation id used for persisted approval policy. */
  agentApprovalSessionId?: string
  cameraSessionId?: string
  /** Adds phone-control tools without removing internal Agent tools. */
  deviceControlEnabled?: boolean
}

export interface BuildToolsResult {
  tools: ToolSet
  instructions: string
  /** Initial model-visible Android tool names; later stages are selected by the SDK. */
  activeTools?: string[]
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function getSessionAttachmentRagIds(messages: Message[]): number[] {
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

export function generateSkillsXml(skills: SkillInfo[], toolUseSupported = false): string {
  const skillEntries = skills
    .map(
      (s) => `<skill>
  <name>${escapeXml(s.name)}</name>
  <description>${escapeXml(s.description)}</description>
</skill>`,
    )
    .join('\n')

  const toolHint = toolUseSupported
    ? [
        '',
        '<skills_usage>',
        'Scan the catalog before acting. When a task clearly matches a skill, call load_skill with its exact listed name before proceeding.',
        'Choose the most specific match. Load more than one only when each is necessary for a distinct part of the task.',
        'Follow the loaded instructions and referenced resources. Use execute_skill_script for a referenced script when that tool is available.',
        'Never invent an unlisted skill name, path, script, or instruction. If no skill matches, use the other available tools.',
        '</skills_usage>',
        '',
      ].join('\n')
    : '\n'

  return `
<available_skills>
${skillEntries}
</available_skills>
${toolHint}`
}

/**
 * Builds the tool set and instructions for a chat session based on model capabilities and session options.
 *
 * Returns tools only for features the model supports.
 * Returns instructions for the system prompt describing available toolsets.
 */
export async function buildToolsForSession(
  model: ModelInterface,
  options: BuildToolsOptions,
): Promise<BuildToolsResult> {
  const { webBrowsing, knowledgeBase, messages, sandboxEnabled, enabledSkillNames, deviceControlEnabled } = options
  const androidDeviceToolSet = createAndroidDeviceToolSet(options.agentSessionId, options.agentApprovalSessionId)
  const memoryToolSet = model.isSupportToolUse() ? createLongTermMemoryToolSet(options.agentApprovalSessionId || options.agentSessionId) : null
  const useSandboxTools = Boolean(sandboxEnabled)

  const hasInlineFileOrLink = messages.some(
    (m) => m.links?.length || m.files?.some((file) => file.ragMode !== 'session-retrieval'),
  )
  const sessionAttachmentIds = getSessionAttachmentRagIds(messages)
  const needFileToolSet = hasInlineFileOrLink && model.isSupportToolUse('read-file')
  const needSessionAttachmentRagToolSet = sessionAttachmentIds.length > 0 && model.isSupportToolUse('read-file')
  const kbSupported = knowledgeBase && model.isSupportToolUse('knowledge-base')
  const webSupported = webBrowsing && model.isSupportToolUse('web-browsing')
  const searchProvider = settingActions.getExtensionSettings().webSearch.provider
  const includeParseLinkTool = webSupported && PROVIDERS_WITH_PARSE_LINK.has(searchProvider)

  let kbToolSet: Awaited<ReturnType<typeof getKBToolSet>> | null = null
  if (knowledgeBase && kbSupported) {
    try {
      kbToolSet = await getKBToolSet(knowledgeBase.id, knowledgeBase.name)
    } catch (err) {
      console.error('Failed to load knowledge base toolset:', err)
    }
  }

  let sessionAttachmentRagToolSet: Awaited<ReturnType<typeof getSessionAttachmentRagToolSet>> | null = null
  if (needSessionAttachmentRagToolSet) {
    try {
      sessionAttachmentRagToolSet = await getSessionAttachmentRagToolSet(sessionAttachmentIds)
    } catch (err) {
      console.error('Failed to load session attachment RAG toolset:', err)
    }
  }

  let instructions = ''
  if (kbToolSet && kbSupported) {
    instructions += kbToolSet.description
  }
  if (sessionAttachmentRagToolSet) {
    instructions += sessionAttachmentRagToolSet.description
  }
  if (needFileToolSet) {
    instructions += fileToolSet.description
  }
  if (webSupported) {
    instructions += getToolSetDescription({ includeParseLink: includeParseLinkTool })
  }
  if (useSandboxTools) {
    instructions += sandboxToolSet.description
  }
  if (deviceControlEnabled && platform.type === 'mobile') {
    instructions += androidDeviceToolSet.description
  }
  if (memoryToolSet) {
    instructions += memoryToolSet.description
  }

  let tools: ToolSet = { ...mcpController.getAvailableTools(options.agentSessionId) }

  const cameraCaptureTool =
    model.isSupportToolUse() && options.cameraSessionId ? createCameraCaptureTool(options.cameraSessionId) : undefined
  if (cameraCaptureTool) {
    tools.camera_capture = cameraCaptureTool
    instructions +=
      '\n<camera_capture>The interactive camera preview is active. Use camera_capture when a fresh visual observation is needed.</camera_capture>\n'
  }

  if (webBrowsing && webSupported) {
    tools.web_search = webSearchTool
    // Inject parse_link based on the selected provider's declared capability.
    // Validation (Pro for build-in, API key for third parties) happens at execution time.
    if (includeParseLinkTool) {
      tools.parse_link = parseLinkTool
    }
  }

  if (kbToolSet && kbSupported) {
    tools = { ...tools, ...kbToolSet.tools }
  }

  if (sessionAttachmentRagToolSet) {
    tools = { ...tools, ...sessionAttachmentRagToolSet.tools }
  }

  if (needFileToolSet) {
    tools = { ...tools, ...fileToolSet.tools }
  }

  if (useSandboxTools) {
    tools = { ...tools, ...sandboxToolSet.tools }
  }
  if (deviceControlEnabled && platform.type === 'mobile') {
    tools = { ...tools, ...androidDeviceToolSet.tools }
  }
  if (memoryToolSet) {
    tools = { ...tools, ...memoryToolSet.tools }
  }
  if (sandboxEnabled && platform.type === 'mobile') {
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
      execute: ({ name, description, instructions }) => skillsController.saveSkill({ name, description }, instructions),
    })
  }

  // Skills integration
  if (enabledSkillNames && enabledSkillNames.length > 0) {
    let allSkills: SkillInfo[] = []
    try {
      allSkills = await skillsController.discoverSkills()
    } catch (err) {
      console.error('Failed to discover skills:', err)
    }

    const enabledSkills = allSkills.filter((s) => enabledSkillNames.includes(s.name))

    if (enabledSkills.length > 0) {
      instructions += generateSkillsXml(enabledSkills, model.isSupportToolUse())

      if (model.isSupportToolUse()) {
        tools.load_skill = tool({
          description:
            "Load the full instructions of a skill by name. Call this when a task matches a skill's description from the available_skills list.",
          inputSchema: z.object({
            name: z.string().describe('The name of the skill to load'),
          }),
          execute: async (input: { name: string }) => {
            if (!enabledSkillNames.includes(input.name)) {
              return { error: `Skill "${input.name}" is not enabled for this session.` }
            }
            const result = await skillsController.loadSkill(input.name)
            if (!result) {
              return { error: `Skill "${input.name}" not found or could not be loaded.` }
            }
            return { instructions: result.body }
          },
        })

        const scriptExecutionAvailable =
          platform.type !== 'mobile' || (sandboxEnabled && enabledSkills.some((skill) => skill.scriptExecutionEnabled))
        if (scriptExecutionAvailable)
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
              context: ToolExecutionOptions,
            ) => {
              if (!enabledSkillNames.includes(input.skill_name)) {
                return {
                  success: false,
                  stdout: '',
                  stderr: `Skill "${input.skill_name}" is not enabled.`,
                  exitCode: null,
                }
              }
              const result = await skillsController.executeScript(
                input.skill_name,
                input.script_name,
                input.arguments,
                {
                  sessionId: options.agentApprovalSessionId || options.agentSessionId,
                  toolCallId: context.toolCallId,
                  abortSignal: context.abortSignal,
                },
              )
              return result
            },
          })
      }
    }
  }

  const stagedActiveTools =
    deviceControlEnabled && platform.type === 'mobile'
      ? [...Object.keys(tools).filter((name) => !name.startsWith('android_')), ...ANDROID_TOOL_STAGE_INITIAL]
      : undefined

  return {
    tools,
    instructions,
    ...(stagedActiveTools ? { activeTools: [...new Set(stagedActiveTools)] } : {}),
  }
}
