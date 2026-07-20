import type { ModelInterface } from '@shared/models/types'
import type { KnowledgeBase, Message } from '@shared/types'
import type { SkillInfo } from '@shared/types/skills'
import { type ToolExecutionOptions, type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { getAgentBackend } from '@/mobile/agent-broker'
import { ANDROID_TOOL_STAGE_INITIAL } from '@shared/agent/android-tool-stages'
import { createCameraCaptureTool } from '@/mobile/camera-tool'
import { mcpController } from '@/packages/mcp/controller'
import { createAndroidDeviceToolSet } from '@/packages/model-calls/toolsets/android-device'
import fileToolSet from '@/packages/model-calls/toolsets/file'
import { getToolSet as getKBToolSet } from '@/packages/model-calls/toolsets/knowledge-base'
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
  /** Keep mobile device runs to the compact Android/camera tool surface. */
  deviceAgentOnly?: boolean
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
    ? "\nWhen a task matches a skill's description, use the load_skill tool to load its full instructions before proceeding.\n"
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
  const { webBrowsing, knowledgeBase, messages, sandboxEnabled, enabledSkillNames, deviceAgentOnly } = options
  const androidDeviceToolSet = createAndroidDeviceToolSet(options.agentSessionId, options.agentApprovalSessionId)
  const useSandboxTools =
    !deviceAgentOnly && sandboxEnabled && !(platform.type === 'mobile' && getAgentBackend() === 'accessibility')

  const hasInlineFileOrLink = messages.some(
    (m) => m.links?.length || m.files?.some((file) => file.ragMode !== 'session-retrieval'),
  )
  const sessionAttachmentIds = getSessionAttachmentRagIds(messages)
  const needFileToolSet = !deviceAgentOnly && hasInlineFileOrLink && model.isSupportToolUse('read-file')
  const needSessionAttachmentRagToolSet =
    !deviceAgentOnly && sessionAttachmentIds.length > 0 && model.isSupportToolUse('read-file')
  const kbSupported = !deviceAgentOnly && knowledgeBase && model.isSupportToolUse('knowledge-base')
  const webSupported = !deviceAgentOnly && webBrowsing && model.isSupportToolUse('web-browsing')
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
  if (sandboxEnabled && platform.type === 'mobile') {
    instructions += deviceAgentOnly
      ? '\n<android_device_agent>Use the local App Index and semantic Android actions. Launch by app name or package; observe before acting and verify after side effects.</android_device_agent>\n'
      : androidDeviceToolSet.description
  }

  let tools: ToolSet = deviceAgentOnly ? {} : { ...mcpController.getAvailableTools(options.agentSessionId) }

  const cameraCaptureTool =
    !deviceAgentOnly && model.isSupportToolUse() && options.cameraSessionId
      ? createCameraCaptureTool(options.cameraSessionId)
      : undefined
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
  if (sandboxEnabled && platform.type === 'mobile') {
    tools = { ...tools, ...androidDeviceToolSet.tools }
    if (!deviceAgentOnly)
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
        execute: ({ name, description, instructions }) =>
          skillsController.saveSkill({ name, description }, instructions),
      })
  }

  // Skills integration
  if (!deviceAgentOnly && enabledSkillNames && enabledSkillNames.length > 0) {
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
          platform.type !== 'mobile' || enabledSkills.some((skill) => skill.scriptExecutionEnabled)
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
            context: ToolExecutionOptions
          ) => {
            if (!enabledSkillNames.includes(input.skill_name)) {
              return {
                success: false,
                stdout: '',
                stderr: `Skill "${input.skill_name}" is not enabled.`,
                exitCode: null,
              }
            }
            const result = await skillsController.executeScript(input.skill_name, input.script_name, input.arguments, {
              sessionId: options.agentApprovalSessionId || options.agentSessionId,
              toolCallId: context.toolCallId,
              abortSignal: context.abortSignal,
            })
            return result
          },
          })
      }
    }
  }

  return {
    tools,
    instructions,
    ...(deviceAgentOnly ? { activeTools: [...ANDROID_TOOL_STAGE_INITIAL] } : {}),
  }
}
