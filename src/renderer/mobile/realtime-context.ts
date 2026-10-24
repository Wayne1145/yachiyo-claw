import type { ModelInterface } from '@shared/models/types'
import { createMessage, type Message, type MessageToolCallPart } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { asSchema } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import { registerBuiltinFeatures } from '@/features/builtin-features'
import { registerBuiltinFeatureLifecycles, type SandboxRunState } from '@/features/builtin-lifecycles'
import { getEnabledFeatureIds } from '@/features/feature-runtime'
import { beginAgentRun, type AgentRunLifecycleHandle } from '@/features/lifecycle-runner'
import { getSession, updateSessionWithMessages } from '@/stores/chatStore'
import { settingsStore } from '@/stores/settingsStore'
import { buildToolsForSession } from '@/stores/session/tools-builder'
import { getTaskSession, updateTaskSession } from '@/stores/taskSessionStore'
import { buildTaskSystemPrompt } from '@/stores/taskSystemPrompt'
import { getAgentSessionConfig } from './agent-session-config'
import { buildSharedUserContextPrompt } from './shared-user-context'
import { getDisabledAgentCapabilityPrompt } from './agent-disabled-prompt'
import { getActiveAgentRun, getActiveAgentSession, setActiveAgentRun, setActiveAgentSession } from './agent-approval'
import type { RealtimeHistoryItem } from './realtime-protocol'
import { upsertRealtimeMessage } from './realtime-history'

/** Reuse the same broker-wrapped tool definitions. Realtime never gets a direct native escape hatch. */
export async function prepareRealtimeContext(
  sessionId: string,
  taskId: string | undefined,
  signal: AbortSignal,
  requestAbort: () => void,
  runId = `realtime:${uuidv4()}`
) {
  const chat = await getSession(sessionId)
  if (!chat) throw new Error('chat_session_not_found')
  const task = taskId ? await getTaskSession(taskId) : undefined
  const config = getAgentSessionConfig(taskId || sessionId)
  const agent = Boolean(task)
  if (agent && getActiveAgentRun() && getActiveAgentRun() !== runId)
    throw new Error('请先等待当前 Agent 任务结束，再开始实时 Agent 通话')
  registerBuiltinFeatures()
  registerBuiltinFeatureLifecycles()
  const enabled = getEnabledFeatureIds()
  let lifecycle: AgentRunLifecycleHandle | undefined
  try {
    if (agent && taskId) {
      setActiveAgentRun(runId)
      setActiveAgentSession(taskId)
      lifecycle = await beginAgentRun(
        {
          agentRunId: runId,
          taskId,
          abortSignal: signal,
          requestAbort,
          featureOptions: {
            'android-device': { enabled: config.deviceControlEnabled },
            sandbox: { workingDirectory: task?.workingDirectory || config.workingDirectory },
          },
        },
        enabled
      )
    }
    const sandbox = lifecycle?.getFeatureState<SandboxRunState>('sandbox')?.enabled ?? false
    // The realtime provider supports structured function calls independently of chat-model metadata.
    const capabilities = {
      isSupportToolUse: () => true,
      isSupportVision: () => true,
      isSupportSystemMessage: () => true,
    } as unknown as ModelInterface
    const set = await buildToolsForSession(capabilities, {
      messages: chat.messages,
      agentSessionId: agent ? runId : sessionId,
      agentApprovalSessionId: taskId || sessionId,
      featureOptions: {
        'core-agent': { agentMode: agent },
        'web-search': { webBrowsing: agent },
        sandbox: { sandboxEnabled: sandbox },
        workspace: { sandboxEnabled: sandbox },
        skills: {
          enabledSkillNames: agent ? settingsStore.getState().skills.enabledSkillNames : [],
          sandboxEnabled: sandbox,
        },
        'android-device': { deviceControlEnabled: agent && config.deviceControlEnabled },
        camera: { cameraSessionId: taskId || sessionId },
        mcp: { agentSessionId: taskId || sessionId },
      },
    })
    const definitions = await Promise.all(
      Object.entries(set.tools).map(async ([name, definition]) => ({
        type: 'function',
        name,
        description: definition.description,
        parameters: await asSchema(definition.inputSchema).jsonSchema,
      }))
    )
    const persona = chat.messages
      .filter((m) => m.role === 'system')
      .map((m) => getMessageText(m))
      .join('\n\n')
    const instructions = [
      persona,
      buildSharedUserContextPrompt(),
      agent
        ? buildTaskSystemPrompt(task?.workingDirectory || config.workingDirectory, {
            deviceAgent: config.deviceControlEnabled,
            enabledFeatureIds: enabled,
          })
        : getDisabledAgentCapabilityPrompt(sessionId),
      set.instructions,
      'This is a live audio conversation. Speak naturally. Use available tools when needed and never claim an action succeeded without its result.',
    ]
      .filter(Boolean)
      .join('\n\n')
    const history: RealtimeHistoryItem[] = (task?.messages || chat.messages)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-30)
      .flatMap((m) =>
        m.role === 'user' || m.role === 'assistant' ? [{ role: m.role, text: getMessageText(m).slice(-6000) }] : []
      )
      .filter((item) => item.text)
    const dispose = async () => {
      if (getActiveAgentRun() === runId) setActiveAgentRun(null)
      if (agent && getActiveAgentSession() === taskId) setActiveAgentSession(null)
      await lifecycle?.disposeAll()
    }
    return { instructions, definitions, tools: set.tools, history, dispose }
  } catch (error) {
    if (getActiveAgentRun() === runId) setActiveAgentRun(null)
    if (agent && getActiveAgentSession() === taskId) setActiveAgentSession(null)
    await lifecycle?.disposeAll()
    throw error
  }
}

export async function saveRealtimeTranscript(
  sessionId: string,
  taskId: string | undefined,
  id: string,
  role: 'user' | 'assistant',
  text: string,
  timestamp?: number
) {
  if (!text.trim()) return
  const message = { ...createMessage(role, text), id, ...(timestamp ? { timestamp } : {}) }
  await saveRealtimeMessage(sessionId, taskId, message)
}

export async function saveRealtimeTool(
  sessionId: string,
  taskId: string | undefined,
  id: string,
  name: string,
  args: unknown,
  result: unknown,
  failed: boolean
) {
  const part: MessageToolCallPart = {
    type: 'tool-call',
    toolCallId: id,
    toolName: name,
    args,
    result,
    state: failed ? 'error' : 'result',
  }
  await saveRealtimeMessage(sessionId, taskId, { ...createMessage('assistant', ''), id, contentParts: [part] })
}

async function saveRealtimeMessage(sessionId: string, taskId: string | undefined, message: Message) {
  if (taskId) {
    await updateTaskSession(taskId, (current) => ({
      ...current,
      messages: upsertRealtimeMessage(current.messages, message),
    }))
  } else {
    await updateSessionWithMessages(sessionId, (current) => {
      if (!current) throw new Error('chat_session_not_found')
      return { ...current, messages: upsertRealtimeMessage(current.messages, message) }
    })
  }
}
