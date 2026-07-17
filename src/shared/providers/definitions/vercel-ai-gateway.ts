import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import VercelAIGateway from './models/vercel-ai-gateway'

export const vercelAIGatewayProvider = defineProvider({
  id: ModelProviderEnum.VercelAIGateway,
  name: 'Vercel AI Gateway',
  type: ModelProviderType.OpenAI,
  curatedModelIds: [
    'google/gemini-3.5-flash',
    'anthropic/claude-opus-4.6',
    'xai/grok-4.1-fast-non-reasoning',
    'anthropic/claude-sonnet-4.6',
    'openai/gpt-5.4-mini',
    'minimax/minimax-m2.7',
    'google/gemini-2.5-flash-lite',
    'anthropic/claude-haiku-4.5',
    'moonshotai/kimi-k2.6',
    'openai/gpt-5.4',
    'google/gemini-3.1-pro-preview',
    'kwaipilot/kat-coder-pro-v2',
  ],
  urls: {
    website: 'https://vercel.com/ai-gateway',
    docs: 'https://vercel.com/docs/ai-gateway',
    models: 'https://vercel.com/ai-gateway/models',
  },
  defaultSettings: {
    apiHost: 'https://ai-gateway.vercel.sh/v3/ai',
    models: [
      // --- Google ---
      {
        modelId: 'google/gemini-3.5-flash',
        nickname: 'Gemini 3.5 Flash',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'google/gemini-3.1-pro-preview',
        nickname: 'Gemini 3.1 Pro',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'google/gemini-2.5-flash-lite',
        nickname: 'Gemini 2.5 Flash Lite',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      // --- Anthropic ---
      {
        modelId: 'anthropic/claude-opus-4.6',
        nickname: 'Claude Opus 4.6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 32_000,
      },
      {
        modelId: 'anthropic/claude-sonnet-4.6',
        nickname: 'Claude Sonnet 4.6',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 200_000,
        maxOutput: 64_000,
      },
      {
        modelId: 'anthropic/claude-haiku-4.5',
        nickname: 'Claude Haiku 4.5',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 200_000,
        maxOutput: 8_192,
      },
      // --- OpenAI ---
      {
        modelId: 'openai/gpt-5.4',
        nickname: 'GPT-5.4',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      {
        modelId: 'openai/gpt-5.4-mini',
        nickname: 'GPT-5.4 Mini',
        capabilities: ['tool_use', 'reasoning', 'vision'],
        contextWindow: 400_000,
        maxOutput: 128_000,
      },
      // --- xAI ---
      {
        modelId: 'xai/grok-4.1-fast-non-reasoning',
        nickname: 'Grok 4.1 Fast',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 2_000_000,
        maxOutput: 30_000,
      },
      // --- MiniMax ---
      {
        modelId: 'minimax/minimax-m2.7',
        nickname: 'MiniMax M2.7',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      {
        modelId: 'minimax/minimax-m2.5',
        nickname: 'MiniMax M2.5',
        capabilities: ['tool_use', 'vision'],
        contextWindow: 1_048_576,
        maxOutput: 65_536,
      },
      // --- Moonshot ---
      {
        modelId: 'moonshotai/kimi-k2.6',
        nickname: 'Kimi K2.6',
        capabilities: ['tool_use'],
        contextWindow: 131_072,
        maxOutput: 32_768,
      },
      // --- KwaiPilot ---
      {
        modelId: 'kwaipilot/kat-coder-pro-v2',
        nickname: 'KAT Coder Pro V2',
        capabilities: ['tool_use'],
        contextWindow: 131_072,
        maxOutput: 32_768,
      },
    ],
  },
  createModel: (config) => {
    return new VercelAIGateway(
      {
        apiKey: config.effectiveApiKey,
        apiHost: config.formattedApiHost ? config.formattedApiHost.replace(/\/$/, '') : undefined,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        useProxy: config.providerSetting.useProxy,
        stream: config.settings.stream,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `Vercel AI Gateway (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
