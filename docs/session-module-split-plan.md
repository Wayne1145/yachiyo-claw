# Session Module Split Plan

**Purpose**: Document the dependency analysis and proposed module split for `src/renderer/stores/sessionActions.ts` (1799 lines) to enable safe refactoring without circular imports.

## Current State

The `sessionActions.ts` file has grown to 1799 lines and handles multiple responsibilities:
- Session CRUD operations
- Message operations
- Thread/history management
- Fork (message branching) operations
- AI generation orchestration
- Session/thread naming
- Export functionality

## Module-Level State

The file contains two shared state objects that must be moved to a central location:

```typescript
// Line 1054-1055
const pendingNameGenerations = new Map<string, ReturnType<typeof setTimeout>>()
const activeNameGenerations = new Set<string>()
```

**Purpose**: Debounce and deduplicate name generation requests
**Used by**: `scheduleGenerateNameAndThreadName`, `scheduleGenerateThreadName`
**Strategy**: Move to `stores/session/state.ts` and import where needed

## Dependency Graph

### Call Chains (Critical Paths)

```
submitNewUserMessage
  └── insertMessage
  └── insertMessageAfter  
  └── modifyMessage
  └── generate (internal)
        └── genMessageContext
        └── streamText (external)
        └── generateImage (external)
        └── modifyMessage
        └── trackGenerateEvent (internal)

generateMore
  └── insertMessageAfter
  └── generate (internal)

generateMoreInNewFork
  └── createNewFork
  └── generateMore

regenerateInNewFork  
  └── findMessageLocation (internal)
  └── createNewFork
  └── generateMore (or passed in runGenerateMore)
  └── generate (internal, fallback)

scheduleGenerateNameAndThreadName
  └── generateNameAndThreadName (internal)
        └── _generateName (internal)
              └── modifyNameAndThreadName

scheduleGenerateThreadName
  └── generateThreadName (internal)
        └── _generateName (internal)
              └── modifyThreadName

createNewFork / switchFork / deleteFork / expandFork
  └── buildCreateForkPatch / buildSwitchForkPatch / buildDeleteForkPatch / buildExpandForkPatch (internal)
        └── applyForkTransform (internal)
              └── switchForkInMessages (internal, for switchFork only)
              └── computeNextMessageForksHash (internal)

startNewThread
  └── refreshContextAndCreateNewThread

moveThreadToConversations
  └── copySession (internal)
  └── removeThread
  └── switchCurrentSession

moveCurrentThreadToConversations
  └── copySession (internal)
  └── removeCurrentThread
  └── switchCurrentSession
```

### External Dependencies (imports)

| Import | Used By |
|--------|---------|
| `@dnd-kit/sortable` (arrayMove) | reorderSessions |
| `@sentry/react` | submitNewUserMessage, generate, _generateName |
| `@shared/defaults` | refreshContextAndCreateNewThread, compressAndCreateThread |
| `@shared/models` (getModel) | submitNewUserMessage, generate, _generateName |
| `jotai` (getDefaultStore) | switchCurrentSession, switchToNext |
| `lodash` (identity, omit, pickBy) | copySession, generate |
| `uuid` (uuidv4) | refreshContextAndCreateNewThread, switchThread, compressAndCreateThread, fork operations |
| `@/adapters` (createModelDependencies) | submitNewUserMessage, generate, _generateName |
| `@/hooks/dom` | startNewThread, compressAndCreateThread |
| `@/i18n/locales` | _generateName |
| `@/packages/apple_app_store` | generate |
| `@/packages/context-management` | submitNewUserMessage, genMessageContext |
| `@/packages/model-calls` | generate, _generateName |
| `@/packages/model-setting-utils` | submitNewUserMessage, generate |
| `@/packages/token` | insertMessage, insertMessageAfter, modifyMessage, genMessageContext |
| `@/router` | switchCurrentSession |
| `@/storage/StoreStorage` | generate |
| `@/utils/session-utils` | reorderSessions |
| `@/utils/track` | trackGenerateEvent |
| `@shared/models/errors` | submitNewUserMessage, generate |
| `@shared/types` | Various (type imports) |
| `@shared/utils/message` | Various message operations |
| `../packages/prompts` | _generateName |
| `../platform` | submitNewUserMessage, generate, _generateName |
| `../storage` | generate, genMessageContext |
| `./atoms` | switchCurrentSession, switchToNext |
| `./chatStore` | Most operations |
| `./scrollActions` | switchCurrentSession, startNewThread, compressAndCreateThread, switchThread |
| `./sessionHelpers` | createEmpty, refreshContextAndCreateNewThread, compressAndCreateThread, exportSessionChat |
| `./settingActions` | submitNewUserMessage |
| `./settingsStore` | generate, _generateName |
| `./uiStore` | getSessionWebBrowsing, generate |

## Proposed Module Assignments

### `stores/session/state.ts`
Shared module state (no dependencies on other session modules):
```typescript
export const pendingNameGenerations = new Map<string, ReturnType<typeof setTimeout>>()
export const activeNameGenerations = new Set<string>()
```

### `stores/session/types.ts`
Internal types used across modules:
```typescript
export type MessageForkEntry = NonNullable<Session['messageForksHash']>[string]
export type MessageLocation = { list: Message[]; index: number }
```

### `stores/session/crud.ts` (~150 lines)
Session lifecycle operations:
- `createEmpty` - creates new chat/picture session
- `copyAndSwitchSession` - duplicates session
- `switchCurrentSession` - changes active session  
- `switchToIndex` - switch by index
- `switchToNext` - switch to next/prev
- `reorderSessions` - drag-drop reorder
- `clearConversationList` - bulk delete sessions
- `clear` - clear messages in session

**Internal**: `create`, `copySession`, `clearSessionList`

**Dependencies**: chatStore, atoms, scrollActions, router, sessionHelpers

### `stores/session/messages.ts` (~200 lines)
Message CRUD operations:
- `insertMessage` - add message to session
- `insertMessageAfter` - insert after specific message
- `modifyMessage` - update message
- `removeMessage` - delete message
- `submitNewUserMessage` - handle user input with AI response

**Dependencies**: chatStore, settingActions, settingsStore, generation.ts (imports `generate`)

**Note**: `submitNewUserMessage` calls `generate` - will need to import from generation.ts

### `stores/session/threads.ts` (~250 lines)
Thread/history management:
- `editThread` - rename thread
- `removeThread` - delete thread
- `switchThread` - change active thread
- `refreshContextAndCreateNewThread` - archive current, start fresh
- `startNewThread` - wrapper with scroll/focus
- `removeCurrentThread` - delete current thread
- `compressAndCreateThread` - compress with summary
- `moveThreadToConversations` - promote thread to session
- `moveCurrentThreadToConversations` - promote current thread

**Dependencies**: chatStore, scrollActions, dom, sessionHelpers, crud.ts (for switchCurrentSession, copySession)

### `stores/session/forks.ts` (~400 lines)
Message fork/branch operations:
- `createNewFork` - create branch point
- `switchFork` - navigate branches
- `deleteFork` - remove current branch
- `expandFork` - flatten all branches

**Internal helpers**:
- `buildCreateForkPatch`
- `buildSwitchForkPatch`
- `buildDeleteForkPatch`
- `buildExpandForkPatch`
- `switchForkInMessages`
- `applyForkTransform`
- `computeNextMessageForksHash`

**Dependencies**: chatStore, types.ts

### `stores/session/generation.ts` (~450 lines)
AI generation orchestration:
- `generate` (internal, but used by messages.ts) - core generation logic
- `generateMore` - continue generation
- `generateMoreInNewFork` - new branch + generate
- `regenerateInNewFork` - regenerate in new branch
- `createLoadingPictures` - placeholder images
- `genMessageContext` - build prompt context
- `getMessageThreadContext` - get thread messages

**Internal helpers**:
- `trackGenerateEvent`
- `getSessionWebBrowsing`
- `findMessageLocation`

**Dependencies**: chatStore, settingsStore, uiStore, platform, storage, model-calls, messages.ts (circular - see below)

**Circular Dependency Issue**: 
- `generation.ts` exports `generate` which is called by `submitNewUserMessage` in `messages.ts`
- `generate` doesn't call anything from messages.ts directly (it calls `modifyMessage` but that can be imported directly)
- **Solution**: `messages.ts` imports `generate` from `generation.ts`. No circular dependency.

### `stores/session/naming.ts` (~150 lines)
Session/thread naming:
- `modifyNameAndThreadName` - update session + thread name
- `modifyThreadName` - update thread name only
- `scheduleGenerateNameAndThreadName` - debounced auto-naming
- `scheduleGenerateThreadName` - debounced thread naming

**Internal helpers**:
- `_generateName` - core name generation
- `generateNameAndThreadName` - wrapper
- `generateThreadName` - wrapper

**Dependencies**: chatStore, settingsStore, platform, state.ts, model-calls, prompts

### `stores/session/export.ts` (~20 lines)
Export functionality:
- `exportSessionChat` - export session to file

**Dependencies**: chatStore, sessionHelpers

### `stores/session/index.ts`
Re-exports all public functions (37 total):

```typescript
// CRUD (7)
export { createEmpty, copyAndSwitchSession, switchCurrentSession } from './crud'
export { switchToIndex, switchToNext, reorderSessions, clearConversationList, clear } from './crud'

// Messages (5)
export { insertMessage, insertMessageAfter, modifyMessage, removeMessage } from './messages'
export { submitNewUserMessage } from './messages'

// Threads (9)
export { editThread, removeThread, switchThread } from './threads'
export { refreshContextAndCreateNewThread, startNewThread, removeCurrentThread } from './threads'
export { compressAndCreateThread, moveThreadToConversations, moveCurrentThreadToConversations } from './threads'

// Forks (4)
export { createNewFork, switchFork, deleteFork, expandFork } from './forks'

// Generation (6)
export { generateMore, generateMoreInNewFork, regenerateInNewFork } from './generation'
export { createLoadingPictures, genMessageContext, getMessageThreadContext } from './generation'

// Naming (4)
export { modifyNameAndThreadName, modifyThreadName } from './naming'
export { scheduleGenerateNameAndThreadName, scheduleGenerateThreadName } from './naming'

// Export (1)
export { exportSessionChat } from './export'
```

**Total exported: 36 functions** (Note: `clear` is included in CRUD = 37)

## Shared State Handling Strategy

**Decision: Centralized State Module**

The `pendingNameGenerations` and `activeNameGenerations` Maps will be moved to `stores/session/state.ts` and imported by `naming.ts`.

**Rationale**:
1. These are simple, isolated state containers
2. Only used by naming operations
3. No complex initialization or cleanup needed
4. Easy to import without circular dependencies

**Alternative considered**: Zustand store
- Rejected because the state is only used internally for debouncing
- No need for reactivity or persistence

## Migration Order

1. **US-001**: Create directory structure + state.ts + types.ts
2. **US-002**: Extract crud.ts (no dependencies on other new modules)
3. **US-003**: Extract messages.ts (depends on generation.ts - stub import initially)
4. **US-004**: Extract threads.ts (depends on crud.ts)
5. **US-005**: Extract forks.ts (independent)
6. **US-006**: Extract generation.ts (provides `generate` to messages.ts)
7. **US-007**: Extract naming.ts (uses state.ts)
8. **US-008**: Extract export.ts (independent)
9. **US-009**: Clean up sessionActions.ts to be re-export facade
10. **US-010**: Finalize index.ts with all exports

## Verification Checklist

- [ ] No circular dependencies (`npx madge --circular src/renderer/stores/`)
- [ ] TypeScript compiles (`npm run check`)
- [ ] All 37 exports accessible from sessionActions.ts
- [ ] Internal helpers (prefixed with `_`) not exported
- [ ] Module state properly isolated in state.ts

## File Size Targets

| Module | Estimated Lines |
|--------|-----------------|
| state.ts | ~10 |
| types.ts | ~20 |
| crud.ts | ~150 |
| messages.ts | ~200 |
| threads.ts | ~250 |
| forks.ts | ~400 |
| generation.ts | ~450 |
| naming.ts | ~150 |
| export.ts | ~20 |
| index.ts | ~50 |
| **sessionActions.ts (facade)** | **<100** |

## Risk Mitigation

1. **Circular imports**: The main risk is between `messages.ts` and `generation.ts`. Analysis shows `generate` is called by `submitNewUserMessage`, but `generate` only calls `modifyMessage` which can be a direct chatStore call. No circular dependency.

2. **Missing exports**: Use TypeScript to ensure all 37 exports are available after split.

3. **Broken imports**: Update all imports in codebase to use `sessionActions.ts` facade (re-exports maintain compatibility).

4. **State synchronization**: pendingNameGenerations/activeNameGenerations are simple Maps/Sets - no sync issues expected.
