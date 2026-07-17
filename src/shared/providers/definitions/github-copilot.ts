import { ModelProviderType } from '../../types'
import { createCopilotOAuthFetch, createOAuthCredentialManager } from '../../oauth'
import { defineProvider } from '../registry'
import OpenAI from './models/openai'

// The Copilot API base URL (no /v1 prefix)
const COPILOT_API_HOST = 'https://api.githubcopilot.com'

// Headers required by GitHub Copilot API on every request
const COPILOT_API_HEADERS: Record<string, string> = {
  'Openai-Intent': 'conversation-edits',
}

export const githubCopilotProvider = defineProvider({
  id: 'github-copilot',
  name: 'GitHub Copilot',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://github.com/features/copilot',
  },
  defaultSettings: {
    apiHost: COPILOT_API_HOST,
    models: [
      {
        modelId: 'gpt-4o',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 128_000,
        maxOutput: 4_096,
      },
      {
        modelId: 'gpt-4o-mini',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 128_000,
        maxOutput: 4_096,
      },
      {
        modelId: 'o4-mini',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 200_000,
        maxOutput: 100_000,
      },
      {
        modelId: 'o3-mini',
        capabilities: ['vision', 'tool_use', 'reasoning'],
        contextWindow: 200_000,
        maxOutput: 200_000,
      },
      {
        modelId: 'claude-sonnet-4',
        capabilities: ['vision', 'reasoning', 'tool_use'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'claude-haiku-3.5',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 200_000,
        maxOutput: 8_192,
      },
      {
        modelId: 'gemini-2.0-flash',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 1_048_576,
        maxOutput: 8_192,
      },
    ],
  },
  createModel: (config) => {
    const isOAuth = config.providerSetting.activeAuthMode === 'oauth' && !!config.providerSetting.oauth?.accessToken
    const credentialManager = createOAuthCredentialManager(
      'github-copilot',
      config.providerSetting,
      config.dependencies
    )
    return new OpenAI(
      {
        apiKey: isOAuth ? 'oauth-placeholder' : config.effectiveApiKey,
        apiHost: COPILOT_API_HOST,
        model: config.model,
        dalleStyle: 'vivid',
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        injectDefaultMetadata: config.globalSettings.injectDefaultMetadata,
        useProxy: false,
        stream: config.settings.stream,
        // Copilot API doesn't use /v1 prefix
        skipHostNormalization: true,
        // Copilot API requires these headers
        extraHeaders: COPILOT_API_HEADERS,
        customFetch:
          isOAuth && credentialManager ? createCopilotOAuthFetch(config.dependencies, credentialManager) : undefined,
        listModelsFallback: isOAuth
          ? config.providerSetting.models || githubCopilotProvider.defaultSettings?.models
          : undefined,
        skipRemoteModelList: isOAuth,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `GitHub Copilot (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
