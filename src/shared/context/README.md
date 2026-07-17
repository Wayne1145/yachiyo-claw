# Context Module

Pure function context builder for AI message preparation. **Production context builder** used by orchestration layer.

## Exports

```typescript
import { buildContext } from '@shared/context'
import type { AttachmentResolver, ContextBuilderOptions } from '@shared/context'
```

## Core API

### buildContext()

**Production context builder** - Pure function that prepares messages for AI generation.

Used directly by `orchestration.ts` and wrapped by `genMessageContext()` in the session module.

```typescript
async function buildContext(
  messages: Message[],
  options: ContextBuilderOptions
): Promise<Message[]>
```

**Processing pipeline:**
1. Filter incomplete messages (`generating: true`)
2. Apply compaction (from latest compaction point)
3. Apply message count limit
4. Inject attachment content via AttachmentResolver

**Usage pattern:**
```typescript
import { buildContext, createAttachmentResolver } from '@shared/context'

const resolver = createAttachmentResolver()
const contextMessages = await buildContext(messages, {
  attachmentResolver: resolver,
  maxContextMessageCount: 50,
})
```

### AttachmentResolver

Platform abstraction for reading attachments. Implemented by renderer.

```typescript
interface AttachmentResolver {
  read(id: string): Promise<string | null>
}
```

### ContextBuilderOptions

```typescript
interface ContextBuilderOptions {
  attachmentResolver: AttachmentResolver
  maxContextMessageCount?: number
  compactionPoints?: CompactionPoint[]
  keepToolCallRounds?: number
  modelSupportToolUseForFile?: boolean
}
```

**Options:**
- `attachmentResolver` - Required. Platform abstraction for accessing attachments
- `maxContextMessageCount` - Optional. Limits context to the most recent N messages
- `compactionPoints` - Optional. History compression points for context optimization
- `keepToolCallRounds` - Optional. Number of recent tool call rounds to preserve (default: 2)
- `modelSupportToolUseForFile` - Optional. Whether model supports tool use for file reading (default: false)

## Architecture

- **Single source of truth** - `buildContext()` is the only context builder in production
- **Zero renderer dependencies** - Pure shared module
- **Immutable** - Never mutates input messages
- **Dependency injection** - AttachmentResolver provided by caller
- **Thin wrapper pattern** - `genMessageContext()` in session module wraps `buildContext()` with session-specific logic
