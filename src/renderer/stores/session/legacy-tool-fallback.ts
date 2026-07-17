import type { ModelInterface } from '@shared/models/types'
import type { Message, MessageToolCallPart } from '@shared/types'
import { uniqueId } from 'lodash'
import {
  combinedSearchByPromptEngineering,
  constructMessagesWithKnowledgeBaseResults,
  constructMessagesWithSearchResults,
  knowledgeBaseSearchByPromptEngineering,
  searchByPromptEngineering,
} from '@/packages/model-calls/tools'

export async function applyLegacyToolFallback(options: {
  model: ModelInterface
  promptMsgs: Message[]
  knowledgeBase: { id: number } | undefined
  webBrowsing: boolean
  signal: AbortSignal
}): Promise<{
  promptMsgs: Message[]
  fallbackToolCallPart: MessageToolCallPart | undefined
}> {
  const { model, signal } = options
  let { promptMsgs } = options
  let fallbackToolCallPart: MessageToolCallPart | undefined

  const kbNotSupported = options.knowledgeBase && !model.isSupportToolUse('knowledge-base')
  const webNotSupported = options.webBrowsing && !model.isSupportToolUse('web-browsing')

  if (!kbNotSupported && !webNotSupported) {
    return { promptMsgs, fallbackToolCallPart }
  }

  if (kbNotSupported && webNotSupported && options.knowledgeBase) {
    const callResult = await combinedSearchByPromptEngineering(model, promptMsgs, options.knowledgeBase.id, signal)
    if (callResult.searchResults.length && callResult.type !== 'none') {
      const toolName = callResult.type === 'knowledge_base' ? 'query_knowledge_base' : 'web_search'
      fallbackToolCallPart = {
        type: 'tool-call',
        state: 'result',
        toolCallId: `${toolName}_${uniqueId()}`,
        toolName,
        args: { query: callResult.query },
        result: callResult,
      }
      promptMsgs =
        callResult.type === 'knowledge_base'
          ? constructMessagesWithKnowledgeBaseResults(promptMsgs, callResult.searchResults)
          : constructMessagesWithSearchResults(promptMsgs, callResult.searchResults)
    }
  } else if (kbNotSupported && options.knowledgeBase) {
    const callResult = await knowledgeBaseSearchByPromptEngineering(model, promptMsgs, options.knowledgeBase.id)
    if (callResult.searchResults.length) {
      fallbackToolCallPart = {
        type: 'tool-call',
        state: 'result',
        toolCallId: `query_knowledge_base_${uniqueId()}`,
        toolName: 'query_knowledge_base',
        args: { query: callResult.query },
        result: callResult,
      }
      promptMsgs = constructMessagesWithKnowledgeBaseResults(promptMsgs, callResult.searchResults)
    }
  } else if (webNotSupported) {
    const callResult = await searchByPromptEngineering(model, promptMsgs, signal)
    if (callResult.searchResults.length) {
      fallbackToolCallPart = {
        type: 'tool-call',
        state: 'result',
        toolCallId: `web_search_${uniqueId()}`,
        toolName: 'web_search',
        args: { query: callResult.query },
        result: callResult,
      }
      promptMsgs = constructMessagesWithSearchResults(promptMsgs, callResult.searchResults)
    }
  }

  return { promptMsgs, fallbackToolCallPart }
}
