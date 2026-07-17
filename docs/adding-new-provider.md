# Adding a New Provider (Registry Architecture)

This guide documents how to add a new AI provider to Chatbox using the **registry-based architecture**.

## Overview

The provider system uses a centralized registry. Adding a new provider requires:

1. **One definition file** - Registers the provider with `defineProvider()`
2. **One model class file** - Implements the AI SDK interface
3. **One enum entry** - Adds the provider ID to `ModelProviderEnum`
4. **One import** - Side-effect import in `providers/index.ts`

That's it. No more scattered switch statements or setting-util files.

## Step-by-Step Guide

### Step 1: Add Provider to Enum

**File:** `src/shared/types.ts`

Add your provider to `ModelProviderEnum`:

```typescript
export enum ModelProviderEnum {
  // ... existing providers
  YourProvider = 'your-provider',
}
```

### Step 2: Create the Model Class

**File:** `src/shared/providers/definitions/models/your-provider.ts`

For **OpenAI-compatible APIs**, extend `OpenAICompatible`:

```typescript
import type { ModelDependencies } from '@shared/types/adapters'
import type { ProviderModelInfo } from '@shared/types'
import { OpenAICompatible } from '@shared/models/openai-compatible'

export interface YourProviderConfig {
  apiKey: string
  model: ProviderModelInfo
  temperature: number
  topP: number
  maxOutputTokens: number | undefined
  stream: boolean | undefined
}

export default class YourProvider extends OpenAICompatible {
  public name = 'YourProvider'

  constructor(options: YourProviderConfig, dependencies: ModelDependencies) {
    super(
      {
        apiKey: options.apiKey,
        apiHost: 'https://api.yourprovider.com/v1', // Your API base URL
        model: options.model,
        temperature: options.temperature,
        topP: options.topP,
        maxOutputTokens: options.maxOutputTokens,
        stream: options.stream,
      },
      dependencies
    )
  }
}
```

For **custom APIs** (non-OpenAI compatible), extend `AbstractAISDKModel` and implement:
- `streamText()` - Streaming chat completion
- `callChatCompletion()` - Non-streaming chat completion
- Optionally: `isSupportToolUse()`, `isSupportVision()`, `isSupportReasoning()`

See `definitions/models/claude.ts` or `definitions/models/gemini.ts` for examples.

### Step 3: Create the Provider Definition

**File:** `src/shared/providers/definitions/your-provider.ts`

```typescript
import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import YourProvider from './models/your-provider'

export const yourProviderProvider = defineProvider({
  // Required: Unique ID from ModelProviderEnum
  id: ModelProviderEnum.YourProvider,
  
  // Required: Display name shown in UI
  name: 'Your Provider',
  
  // Required: API type (affects model class behavior)
  type: ModelProviderType.OpenAI, // OpenAI | Claude | Gemini
  
  // Optional: Description for UI
  description: 'Your provider description',
  
  // Optional: Related URLs for settings page
  urls: {
    website: 'https://yourprovider.com',
    apiKey: 'https://yourprovider.com/api-keys',
    docs: 'https://yourprovider.com/docs',
  },
  
  // Required: Default configuration
  defaultSettings: {
    apiHost: 'https://api.yourprovider.com',
    models: [
      {
        modelId: 'your-model-v1',
        contextWindow: 128_000,
        maxOutput: 4_096,
        capabilities: ['vision', 'tool_use'], // Optional: vision, tool_use, reasoning
      },
      {
        modelId: 'your-model-v2',
        contextWindow: 200_000,
        maxOutput: 8_192,
      },
    ],
  },
  
  // Required: Factory function to create model instances
  createModel: (config) => {
    return new YourProvider(
      {
        apiKey: config.providerSetting.apiKey || '',
        model: config.model,
        temperature: config.settings.temperature,
        topP: config.settings.topP,
        maxOutputTokens: config.settings.maxTokens,
        stream: config.settings.stream,
      },
      config.dependencies
    )
  },
  
  // Optional: Custom display name for message headers
  getDisplayName: (modelId, providerSettings) => {
    const nickname = providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname
    return `Your Provider (${nickname || modelId})`
  },
})
```

### Step 4: Register the Provider

**File:** `src/shared/providers/index.ts`

Add a side-effect import at the top of the file:

```typescript
import './definitions/your-provider'
```

This import triggers `defineProvider()` which registers the provider in the registry.

### Step 5: Add Provider Icon (Optional but Recommended)

**File:** `src/renderer/components/icons/ProviderIcon.tsx`

Add an SVG icon case:

```typescript
case ModelProviderEnum.YourProvider:
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Your SVG path data */}
    </svg>
  )
```

## ProviderDefinition Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier from `ModelProviderEnum` |
| `name` | `string` | Yes | Display name in UI |
| `type` | `ModelProviderType` | Yes | API type: `OpenAI`, `Claude`, or `Gemini` |
| `description` | `string` | No | Provider description for UI |
| `urls` | `object` | No | Related URLs (website, apiKey, docs, models) |
| `defaultSettings` | `ProviderSettings` | No | Default apiHost and models list |
| `createModel` | `function` | Yes | Factory function that creates model instances |
| `getDisplayName` | `function` | No | Custom display name for message headers |

### CreateModelConfig (passed to createModel)

| Field | Type | Description |
|-------|------|-------------|
| `settings` | `SessionSettings` | Session-level settings (temperature, topP, etc.) |
| `globalSettings` | `Settings` | Global application settings |
| `config` | `Config` | App configuration (uuid, etc.) |
| `dependencies` | `ModelDependencies` | Platform dependencies (fetch, etc.) |
| `providerSetting` | `ProviderSettings` | Provider-specific settings (apiKey, apiHost, models) |
| `formattedApiHost` | `string` | Pre-formatted API host URL |
| `model` | `ProviderModelInfo` | Selected model configuration |

### Model Capabilities

In `defaultSettings.models[].capabilities`, you can specify:

| Capability | Description |
|------------|-------------|
| `vision` | Model supports image inputs |
| `tool_use` | Model supports function/tool calling |
| `reasoning` | Model is a reasoning/thinking model (o1, o3, etc.) |

## Complete Example: Groq Provider

**File:** `src/shared/providers/definitions/groq.ts`

```typescript
import { ModelProviderEnum, ModelProviderType } from '../../types'
import { defineProvider } from '../registry'
import Groq from './models/groq'

export const groqProvider = defineProvider({
  id: ModelProviderEnum.Groq,
  name: 'Groq',
  type: ModelProviderType.OpenAI,
  urls: {
    website: 'https://groq.com/',
  },
  defaultSettings: {
    apiHost: 'https://api.groq.com/openai',
    models: [
      {
        modelId: 'llama-3.3-70b-versatile',
        contextWindow: 131_072,
        maxOutput: 32_768,
        capabilities: ['tool_use'],
      },
    ],
  },
  createModel: (config) => {
    return new Groq(
      {
        apiKey: config.providerSetting.apiKey || '',
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
    return `Groq API (${providerSettings?.models?.find((m) => m.modelId === modelId)?.nickname || modelId})`
  },
})
```

## Testing Your Implementation

1. **TypeScript check:**
   ```bash
   npm run check
   ```

2. **Lint check:**
   ```bash
   npm run lint
   ```

3. **Run development mode:**
   ```bash
   npm run dev
   ```

4. **Verify in the app:**
   - Provider appears in Settings > Provider
   - API key can be configured
   - Models are listed in model selector
   - Chat functionality works

## Migration Notes

The registry-based architecture replaces the previous scattered approach:

| Old Location | New Location |
|--------------|--------------|
| `src/shared/models/your-provider.ts` | `src/shared/providers/definitions/models/your-provider.ts` |
| `src/shared/models/index.ts` switch case | `defineProvider()` in definition file |
| `src/shared/defaults.ts` SystemProviders entry | `defaultSettings` in definition file |
| `src/renderer/packages/model-setting-utils/*-setting-util.ts` | `getDisplayName` in definition file |

All provider information is now consolidated in a single `defineProvider()` call.
