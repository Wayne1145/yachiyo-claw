import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import SiliconFlow from './models/siliconflow'

export const siliconFlowProvider = defineProvider({
  id: ModelProviderEnum.SiliconFlow,
  name: 'SiliconFlow',
  type: ModelProviderType.OpenAI,
  modelsDevProviderId: 'siliconflow',
  curatedModelIds: [
    'deepseek-ai/DeepSeek-V3.2',
    'deepseek-ai/DeepSeek-R1',
    'moonshotai/Kimi-K2.6',
    'moonshotai/Kimi-K2-Thinking',
    'zai-org/GLM-5.1',
    'zai-org/GLM-5V-Turbo',
    'Qwen/Qwen3-32B',
    'Qwen/Qwen3-VL-235B-A22B-Instruct',
    'BAAI/bge-m3',
    'BAAI/bge-reranker-v2-m3',
  ],
  urls: {
    website: 'https://siliconflow.cn/',
  },
  defaultSettings: {
    apiHost: 'https://api.siliconflow.cn',
    models: [
      {
        modelId: 'deepseek-ai/DeepSeek-V3.2',
        capabilities: ['tool_use'],
        contextWindow: 160_000,
      },
      {
        modelId: 'deepseek-ai/DeepSeek-V3.1',
        capabilities: ['tool_use'],
        contextWindow: 160_000,
      },
      {
        modelId: 'deepseek-ai/DeepSeek-R1',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'Pro/deepseek-ai/DeepSeek-R1',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'Pro/deepseek-ai/DeepSeek-V3.1',
        capabilities: ['tool_use'],
        contextWindow: 160_000,
      },
      {
        modelId: 'moonshotai/Kimi-K2.6',
        capabilities: ['tool_use'],
        contextWindow: 256_000,
      },
      {
        modelId: 'moonshotai/Kimi-K2-Thinking',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 256_000,
      },
      {
        modelId: 'zai-org/GLM-5.1',
        capabilities: ['reasoning', 'tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'zai-org/GLM-5V-Turbo',
        capabilities: ['reasoning', 'vision', 'tool_use'],
        contextWindow: 64_000,
      },
      {
        modelId: 'Qwen/Qwen3-32B',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
        capabilities: ['tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
        capabilities: ['vision', 'tool_use'],
        contextWindow: 128_000,
      },
      {
        modelId: 'Qwen/QwQ-32B',
        capabilities: ['tool_use'],
        contextWindow: 32_000,
      },
      { modelId: 'BAAI/bge-m3', type: 'embedding' },
      { modelId: 'BAAI/bge-large-zh-v1.5', type: 'embedding' },
      { modelId: 'Pro/BAAI/bge-m3', type: 'embedding' },
      { modelId: 'BAAI/bge-reranker-v2-m3', type: 'rerank' },
    ],
  },
  createModel: (config) => {
    return new SiliconFlow(
      {
        apiKey: config.effectiveApiKey,
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
      },
      config.dependencies
    )
  },
  getDisplayName: (modelId, providerSettings) => {
    return `SiliconFlow API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
