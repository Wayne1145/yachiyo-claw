# Provider Config Import - Manual Test Cases

This document contains test configurations for manually verifying the provider config import functionality in Chatbox.

## How to Test

1. Copy any of the JSON configurations below
2. In Chatbox, navigate to Settings → Providers
3. Click "Import from Clipboard" button
4. Verify the import results match the expected behavior

## Test Cases

### 1. Valid Custom Provider with All Fields

**Config:**
```json
{
  "id": "test-provider-full",
  "name": "Test Provider Full",
  "type": "openai",
  "iconUrl": "https://example.com/icon.png",
  "urls": {
    "website": "https://example.com",
    "getApiKey": "https://example.com/get-api-key",
    "docs": "https://example.com/docs",
    "models": "https://example.com/models"
  },
  "settings": {
    "apiHost": "https://api.example.com",
    "apiPath": "/v1/chat/completions",
    "apiKey": "test-api-key-123",
    "models": [
      {
        "modelId": "test-gpt-4",
        "nickname": "Test GPT-4",
        "type": "chat",
        "capabilities": ["vision", "tool_use"],
        "contextWindow": 128000,
        "maxOutput": 4096
      },
      {
        "modelId": "test-gpt-3.5",
        "nickname": "Test GPT-3.5",
        "type": "chat",
        "contextWindow": 16385,
        "maxOutput": 4096
      }
    ]
  }
}
```

**Expected Result:**
- ✅ Import successful
- Provider name: "Test Provider Full"
- Icon displayed from URL
- All URLs populated
- 2 models available with correct capabilities

### 2. Minimal Valid Custom Provider

**Config:**
```json
{
  "id": "minimal-provider",
  "name": "Minimal Provider",
  "type": "openai",
  "settings": {
    "apiHost": "https://api.minimal.com"
  }
}
```

**Expected Result:**
- ✅ Import successful
- Provider name: "Minimal Provider"
- No icon (default icon used)
- No preset models
- API key field empty (user needs to add)

### 3. Builtin Provider Configuration

**Config:**
```json
{
  "id": "openai",
  "settings": {
    "apiHost": "https://api.openai.com",
    "apiKey": "sk-test-key-123"
  }
}
```

**Expected Result:**
- ✅ Import successful
- Updates existing OpenAI provider settings
- API host and key populated

### 4. Real-World Provider: openrouter.ai

**Config:**
```json
{
  "id": "openrouter",
  "name": "OpenRouter",
  "type": "openai",
  "iconUrl": "https://openrouter.ai/favicon.ico",
  "urls": {
    "website": "https://openrouter.ai/favicon.ico",
    "getApiKey": "https://openrouter.ai/favicon.ico"
  },
  "settings": {
    "apiHost": "https://api.openrouter.ai",
    "models": [
      {
        "modelId": "gpt-4o",
        "nickname": "GPT-4o",
        "capabilities": ["vision"]
      },
      {
        "modelId": "claude-3-5-sonnet-20241022",
        "nickname": "Claude 3.5 Sonnet"
      },
      {
        "modelId": "gemini-2.0-flash-exp",
        "nickname": "Gemini 2.0 Flash"
      }
    ]
  }
}
```

**Expected Result:**
- ✅ Import successful
- Provider name: "OpenRouter"
- Icon from OpenRouter website
- 3 models with appropriate capabilities

### 5. Provider with Embedding and Rerank Models

**Config:**
```json
{
  "id": "multi-type-provider",
  "name": "Multi Type Provider",
  "type": "openai",
  "settings": {
    "apiHost": "https://api.multitype.com",
    "models": [
      {
        "modelId": "chat-model",
        "type": "chat",
        "capabilities": ["reasoning"]
      },
      {
        "modelId": "embedding-model",
        "type": "embedding"
      },
      {
        "modelId": "rerank-model",
        "type": "rerank"
      }
    ]
  }
}
```

**Expected Result:**
- ✅ Import successful
- Chat model available in chat interface
- Embedding model available for RAG/knowledge base
- Rerank model available for search optimization

### 6. Base64 Encoded Config (Deep Link Format)

To test deep link import, encode any of the above configs to Base64:

**Example (Minimal Provider):**
```
eyJpZCI6Im1pbmltYWwtcHJvdmlkZXIiLCJuYW1lIjoiTWluaW1hbCBQcm92aWRlciIsInR5cGUiOiJvcGVuYWkiLCJzZXR0aW5ncyI6eyJhcGlIb3N0IjoiaHR0cHM6Ly9hcGkubWluaW1hbC5jb20ifX0=
```

**Deep Link URL:**
```
chatbox://provider/import?config=eyJpZCI6Im1pbmltYWwtcHJvdmlkZXIiLCJuYW1lIjoiTWluaW1hbCBQcm92aWRlciIsInR5cGUiOiJvcGVuYWkiLCJzZXR0aW5ncyI6eyJhcGlIb3N0IjoiaHR0cHM6Ly9hcGkubWluaW1hbC5jb20ifX0=
```

**Expected Result:**
- ✅ Deep link opens Chatbox
- Import dialog shows with decoded config
- Same result as manual clipboard import

## Invalid Configurations (Should Fail)

### 7. Missing Required Field: name

**Config:**
```json
{
  "id": "no-name",
  "type": "openai",
  "settings": {
    "apiHost": "https://api.example.com"
  }
}
```

**Expected Result:**
- ❌ Import fails
- Error message: "Invalid provider configuration format"

### 8. Missing Required Field: type

**Config:**
```json
{
  "id": "no-type",
  "name": "No Type Provider",
  "settings": {
    "apiHost": "https://api.example.com"
  }
}
```

**Expected Result:**
- ❌ Import fails
- Error message: "Invalid provider configuration format"

### 9. Invalid Type Value

**Config:**
```json
{
  "id": "invalid-type",
  "name": "Invalid Type",
  "type": "invalid-provider-type",
  "settings": {
    "apiHost": "https://api.example.com"
  }
}
```

**Expected Result:**
- ❌ Import fails
- Error message: "Invalid provider configuration format"

### 10. Invalid Model Capability

**Config:**
```json
{
  "id": "invalid-capability",
  "name": "Invalid Capability",
  "type": "openai",
  "settings": {
    "apiHost": "https://api.example.com",
    "models": [
      {
        "modelId": "model-1",
        "capabilities": ["invalid-capability"]
      }
    ]
  }
}
```

**Expected Result:**
- ❌ Import fails
- Error message: "Invalid provider configuration format"

### 11. Malformed JSON

**Config:**
```
{
  "id": "malformed",
  "name": "Malformed JSON"
  "type": "openai"  // Missing comma
}
```

**Expected Result:**
- ❌ Import fails
- Error message: "Invalid provider configuration format"

## Edge Cases

### 12. Duplicate Provider ID

**Config:**
```json
{
  "id": "openai",
  "name": "My Custom OpenAI",
  "type": "openai",
  "settings": {
    "apiHost": "https://my-custom-api.com"
  }
}
```

**Expected Result:**
- ⚠️ Warning dialog: "Provider 'openai' already exists"
- Options: Replace existing or Cancel

### 13. Provider with Anthropic Type

**Config:**
```json
{
  "id": "anthropic-custom",
  "name": "Custom Anthropic",
  "type": "anthropic",
  "settings": {
    "apiHost": "https://api.anthropic.com"
  }
}
```

**Expected Result:**
- ✅ Import successful (currently defaults to OpenAI type internally)
- Future: Should properly support Anthropic-specific features

## Encoding/Decoding Helper

To create Base64 encoded configs for deep link testing:

```javascript
// Encode
const config = { /* your config object */ };
const encoded = btoa(JSON.stringify(config));
console.log(`chatbox://provider/import?config=${encoded}`);

// Decode
const encoded = "your-base64-string";
const decoded = JSON.parse(atob(encoded));
console.log(decoded);
```

## Notes

- The `isCustom` field is automatically added to custom providers during import
- Provider IDs must be unique
- Built-in provider IDs: chatbox-ai, openai, azure, chatglm-6b, claude, gemini, ollama, groq, deepseek, siliconflow, volcengine, mistral-ai, lm-studio, perplexity, xAI
- Model capabilities: vision, reasoning, tool_use
- Model types: chat, embedding, rerank