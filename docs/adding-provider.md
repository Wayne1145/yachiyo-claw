# Adding a New Provider to Chatbox

This guide documents all the steps and files that need to be modified when adding a new AI provider to the Chatbox application.

## Overview

Adding a new provider involves modifying approximately 7-8 files across the codebase. The implementation follows a consistent pattern, making it straightforward to add support for new AI models.

## Step-by-Step Implementation

### 1. Add Provider to Enum

**File:** `/src/shared/types.ts`

Add your provider to the `ModelProviderEnum`:

```typescript
export enum ModelProviderEnum {
  // ... existing providers
  YourProvider = 'your-provider',
}
```

### 2. Create Provider Implementation

**File:** `/src/shared/models/your-provider.ts`

Create a new file implementing your provider's API. Most providers can extend the base OpenAI-compatible class:

```typescript
import { OpenAICompatible } from './openai-compatible'

export class YourProvider extends OpenAICompatible {
  name = 'YourProvider'

  constructor(apiKey: string, apiHost: string) {
    super(apiKey, apiHost)
  }
}
```

For providers with custom APIs, extend `AbstractAISdk` directly and implement required methods.

### 3. Register Provider in Factory

**File:** `/src/shared/models/index.ts`

Add three entries:

1. Import your provider:
```typescript
import { YourProvider } from './your-provider'
```

2. Add case in `getModel()` function:
```typescript
case ModelProviderEnum.YourProvider:
  return new YourProvider(apiKey, apiHost)
```

3. Add to `aiProviderNameHash`:
```typescript
export const aiProviderNameHash = {
  // ... existing entries
  [ModelProviderEnum.YourProvider]: 'Your Provider Name',
}
```

4. (Optional) Add to `AIModelProviderMenuOptionList` if it should appear in selection menus:
```typescript
export const AIModelProviderMenuOptionList = [
  // ... existing entries
  { value: ModelProviderEnum.YourProvider, label: 'Your Provider' },
]
```

### 4. Configure Default Settings

**File:** `/src/shared/defaults.ts`

Add your provider configuration to the `SystemProviders` array:

```typescript
{
  id: ModelProviderEnum.YourProvider,
  name: 'Your Provider',
  type: ModelProviderType.OpenAI,  // OpenAI | Gemini | Claude
  defaultSettings: {
    apiHost: 'https://api.yourprovider.com',
    models: [
      {
        modelId: 'model-1',
        capabilities: ['vision', 'tool_use'],  // optional
        contextWindow: 128_000,  // optional
      },
    ],
  },
}
```

**Note:** See existing providers in `defaults.ts` for more examples.

### 5. Create Settings Utility

**File:** `/src/renderer/packages/model-setting-utils/your-provider-setting-util.ts`

Create a settings utility class:

```typescript
import { BaseModelSettingUtil } from './base-model-setting-util'
import { ModelProviderEnum } from '@/shared/types'

export class YourProviderSettingUtil extends BaseModelSettingUtil {
  provider = ModelProviderEnum.YourProvider
  
  // Add any provider-specific validation or configuration methods
}
```

### 6. Register Settings Utility

**File:** `/src/renderer/packages/model-setting-utils/index.ts`

Add your utility to the `getModelSettingUtil()` function:

```typescript
import { YourProviderSettingUtil } from './your-provider-setting-util'

export function getModelSettingUtil(provider: ModelProviderEnum): BaseModelSettingUtil {
  const hash = {
    // ... existing entries
    [ModelProviderEnum.YourProvider]: new YourProviderSettingUtil(),
  }
  return hash[provider] || new BaseModelSettingUtil()
}
```

### 7. Add Provider Icons

**SVG Icon - File:** `/src/renderer/components/icons/ProviderIcon.tsx`

Add an SVG icon component in the switch statement:

```typescript
case ModelProviderEnum.YourProvider:
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Your SVG path data */}
    </svg>
  )
```

**PNG Icon - File:** `/src/renderer/static/icons/providers/your-provider.png`

Add a 36x36 PNG icon for the provider list display.

## Optional Steps

### Translations

If your provider requires custom UI text, add translations to the appropriate locale files in `/src/renderer/i18n/locales/`.

### Testing

Create test files for your provider implementation:
- `/src/shared/models/your-provider.test.ts`
- `/src/renderer/packages/model-setting-utils/your-provider-setting-util.test.ts`

### Custom Settings UI

If your provider needs custom settings beyond API key and host, you may need to create a custom component in `/src/renderer/routes/settings/provider/`. However, most providers work with the default settings page.

## Example: Recent VolcEngine Implementation

The VolcEngine provider was recently added following this pattern:

1. Added enum value in `types.ts`
2. Created `/src/shared/models/volcengine.ts` extending OpenAICompatible
3. Added entries in `/src/shared/models/index.ts`
4. Added configuration in `defaults.ts` with chat models
5. Created settings utility
6. Registered utility in index

## Testing Your Implementation

After implementing:

1. Run `npm run lint:fix` to ensure code style consistency
2. Run `npm run check` for TypeScript validation
3. Test the provider in development mode: `npm run dev`
4. Verify:
   - Provider appears in settings
   - API key/host can be configured
   - Models are selectable
   - Chat functionality works

## Common Patterns

- Most providers extend `OpenAICompatible` if they follow OpenAI's API format
- Use `supportContinuous: true` for streaming support
- Set `functionCall: true` on models that support function calling
- The `apiHost` in defaults should not include `/v1` suffix (added automatically)