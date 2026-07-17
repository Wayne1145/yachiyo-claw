import type { ComponentType, ReactElement } from 'react'

// Import only Mono and Color components to avoid @lobehub/ui dependency
import BaichuanColor from '@lobehub/icons/es/Baichuan/components/Color'
import ChatGLMColor from '@lobehub/icons/es/ChatGLM/components/Color'
import ClaudeColor from '@lobehub/icons/es/Claude/components/Color'
import CohereColor from '@lobehub/icons/es/Cohere/components/Color'
import DeepSeekColor from '@lobehub/icons/es/DeepSeek/components/Color'
import DoubaoColor from '@lobehub/icons/es/Doubao/components/Color'
import GeminiColor from '@lobehub/icons/es/Gemini/components/Color'
import GrokMono from '@lobehub/icons/es/Grok/components/Mono'
import HunyuanColor from '@lobehub/icons/es/Hunyuan/components/Color'
import KimiColor from '@lobehub/icons/es/Kimi/components/Color'
import MetaColor from '@lobehub/icons/es/Meta/components/Color'
import MinimaxColor from '@lobehub/icons/es/Minimax/components/Color'
import MistralColor from '@lobehub/icons/es/Mistral/components/Color'
import MoonshotMono from '@lobehub/icons/es/Moonshot/components/Mono'
import OpenAIMono from '@lobehub/icons/es/OpenAI/components/Mono'
import PerplexityColor from '@lobehub/icons/es/Perplexity/components/Color'
import QwenColor from '@lobehub/icons/es/Qwen/components/Color'
import StepfunColor from '@lobehub/icons/es/Stepfun/components/Color'
import YiColor from '@lobehub/icons/es/Yi/components/Color'
import ZhipuColor from '@lobehub/icons/es/Zhipu/components/Color'

interface IconProps {
  size?: number | string
  style?: React.CSSProperties
  className?: string
}

type IconComponent = ComponentType<IconProps>

interface ModelLogoConfig {
  pattern: RegExp
  icon: IconComponent
  darkModeColor?: string // Color to use in dark mode for mono icons
}

/**
 * Mapping of regex patterns to model logo components.
 * Patterns are matched case-insensitively against model IDs.
 * Order matters - more specific patterns should come first.
 */
const modelLogoConfigs: ModelLogoConfig[] = [
  // OpenAI models - black icon, needs white in dark mode
  { pattern: /\b(o1|o3|o4|gpt|chatgpt|codex)/i, icon: OpenAIMono, darkModeColor: '#fff' },

  // Anthropic
  { pattern: /claude/i, icon: ClaudeColor },

  // Google
  { pattern: /gemini/i, icon: GeminiColor },

  // DeepSeek
  { pattern: /deepseek/i, icon: DeepSeekColor },

  // Alibaba
  { pattern: /qwen|qwq|qvq/i, icon: QwenColor },

  // Meta/Llama
  { pattern: /llama/i, icon: MetaColor },

  // Mistral
  { pattern: /mistral|mixtral|codestral|ministral|magistral/i, icon: MistralColor },

  // Moonshot - black icon, needs white in dark mode
  { pattern: /moonshot/i, icon: MoonshotMono, darkModeColor: '#fff' },

  // Kimi
  { pattern: /kimi/i, icon: KimiColor },

  // Zhipu/GLM
  { pattern: /glm/i, icon: ChatGLMColor },
  { pattern: /zhipu/i, icon: ZhipuColor },

  // ByteDance/Doubao
  { pattern: /doubao|ep-202/i, icon: DoubaoColor },

  // Baichuan
  { pattern: /baichuan/i, icon: BaichuanColor },

  // 01.AI/Yi
  { pattern: /yi-/i, icon: YiColor },

  // Tencent/Hunyuan
  { pattern: /hunyuan/i, icon: HunyuanColor },

  // MiniMax
  { pattern: /minimax|abab/i, icon: MinimaxColor },

  // StepFun
  { pattern: /step-/i, icon: StepfunColor },

  // Cohere
  { pattern: /cohere|command-r/i, icon: CohereColor },

  // xAI Grok - black icon, needs white in dark mode
  { pattern: /grok/i, icon: GrokMono, darkModeColor: '#fff' },

  // Perplexity
  { pattern: /perplexity|sonar/i, icon: PerplexityColor },
]

/**
 * Get the model logo configuration for a model based on its ID.
 *
 * @param modelId - The model ID to match against
 * @returns The config if found, undefined otherwise
 */
export function getModelLogoConfig(modelId: string): ModelLogoConfig | undefined {
  if (!modelId) return undefined

  for (const config of modelLogoConfigs) {
    if (config.pattern.test(modelId)) {
      return config
    }
  }

  return undefined
}

/**
 * Render a model icon as a React element.
 *
 * @param modelId - The model ID to match against
 * @param size - Icon size (default: 16)
 * @param isDarkMode - Whether dark mode is active
 * @returns The rendered icon element or undefined
 */
export function renderModelIcon(
  modelId: string,
  size: number = 16,
  isDarkMode: boolean = false
): ReactElement | undefined {
  const config = getModelLogoConfig(modelId)
  if (!config) return undefined

  const { icon: Icon, darkModeColor } = config

  // For mono icons, apply dark mode color if needed
  if (darkModeColor && isDarkMode) {
    return <Icon size={size} style={{ color: darkModeColor }} />
  }

  return <Icon size={size} />
}
