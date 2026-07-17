# PRD: Code Organization Optimization

## Introduction

Reorganize the codebase to improve maintainability by splitting large files into focused modules and restructuring the component directory. This addresses two main issues:

1. **Large files**: `sessionActions.ts` (1798 lines, 37 exports) contains too many responsibilities mixing CRUD, AI generation, naming, threading, forking, and context building
2. **Partially flat component structure**: 59 component files remain flat in `components/` while 43 files are already organized into subdirectories (`InputBox/`, `ModelSelector/`, `icons/`, etc.)

This refactor improves code discoverability, reduces merge conflicts, and makes the codebase more approachable for new contributors.

## Goals

- Split `sessionActions.ts` into focused modules (<300 lines each)
- Organize remaining flat components into logical subdirectories by feature/domain
- Clean up dead code and commented-out type definitions in `types.ts` (~150 lines)
- Establish clear module boundaries and naming conventions
- Maintain all existing functionality without changes
- Enable easier code review by reducing file sizes

## User Stories

### US-000: Analyze sessionActions.ts dependencies (CRITICAL - DO FIRST)
**Description:** As a developer, I need to map internal dependencies before splitting to avoid circular imports.

**Acceptance Criteria:**
- [ ] Create dependency graph showing which functions call which
- [ ] Identify all module-level state:
  - `pendingNameGenerations: Map<string, NodeJS.Timeout>`
  - `activeNameGenerations: Map<string, AbortController>`
- [ ] Design shared state strategy (options: shared state.ts file OR convert to Zustand store)
- [ ] Document call chains, especially:
  - `submitNewUserMessage` -> `generate` -> `scheduleGenerateNameAndThreadName`
  - `generate` -> `genMessageContext`
- [ ] Verify proposed split has no circular import risk
- [ ] Create `docs/session-module-split-plan.md` with findings
- [ ] Typecheck passes

### US-001: Analyze sessionActions.ts responsibilities
**Description:** As a developer, I need to understand all the functions in sessionActions.ts to plan the split correctly.

**Acceptance Criteria:**
- [ ] List all 37 exported functions with their responsibilities
- [ ] Group functions by domain (CRUD, generation, threads, forks, naming, context, export)
- [ ] Identify shared utilities and internal helpers
- [ ] Identify which functions are called from outside vs internal-only
- [ ] Create split plan document
- [ ] Typecheck passes

### US-002: Extract session CRUD operations
**Description:** As a developer, I want session create/read/update/delete operations in a dedicated file.

**Acceptance Criteria:**
- [ ] Create `stores/session/crud.ts`
- [ ] Move: `createEmpty`, `copyAndSwitchSession`
- [ ] Move: `switchCurrentSession`, `switchToIndex`, `switchToNext`
- [ ] Move: `reorderSessions`, `clearConversationList`, `clear`
- [ ] Update imports in sessionActions.ts to re-export
- [ ] All session CRUD operations work unchanged
- [ ] Typecheck passes

### US-003: Extract message operations
**Description:** As a developer, I want message-related operations in a dedicated file.

**Acceptance Criteria:**
- [ ] Create `stores/session/messages.ts`
- [ ] Move: `insertMessage`, `insertMessageAfter`
- [ ] Move: `modifyMessage`, `removeMessage`
- [ ] Move: `submitNewUserMessage` (note: calls `generate`, handle import)
- [ ] Update imports in sessionActions.ts to re-export
- [ ] All message operations work unchanged
- [ ] Typecheck passes

### US-004: Extract thread operations
**Description:** As a developer, I want thread/history operations in a dedicated file.

**Acceptance Criteria:**
- [ ] Create `stores/session/threads.ts`
- [ ] Move: `editThread`, `removeThread`, `switchThread`
- [ ] Move: `refreshContextAndCreateNewThread`, `startNewThread`
- [ ] Move: `removeCurrentThread`, `compressAndCreateThread`
- [ ] Move: `moveThreadToConversations`, `moveCurrentThreadToConversations`
- [ ] Update imports in sessionActions.ts to re-export
- [ ] All thread operations work unchanged
- [ ] Typecheck passes

### US-005: Extract fork operations
**Description:** As a developer, I want message fork operations in a dedicated file.

**Acceptance Criteria:**
- [ ] Create `stores/session/forks.ts`
- [ ] Move exported functions:
  - `createNewFork`, `switchFork`
  - `deleteFork`, `expandFork`
- [ ] Move internal helpers:
  - `buildCreateForkPatch`, `buildSwitchForkPatch`
  - `buildForkUpdatePatch`, `cleanupEmptyForkBranches`
  - `switchForkInMessages`, `applyForkTransform`
- [ ] Move helper types: `MessageForkEntry`, `MessageLocation`
- [ ] Update imports in sessionActions.ts to re-export
- [ ] All fork operations work unchanged
- [ ] Typecheck passes

### US-006: Extract generation operations
**Description:** As a developer, I want AI generation operations in a dedicated file.

**Acceptance Criteria:**
- [ ] Create `stores/session/generation.ts`
- [ ] Move: `generate`, `generateMore`, `generateMoreInNewFork`
- [ ] Move: `regenerateInNewFork`
- [ ] Move: `trackGenerateEvent`
- [ ] Move generation helpers: `createLoadingPictures`
- [ ] Import `genMessageContext` from context module (or packages/)
- [ ] Update imports in sessionActions.ts to re-export
- [ ] All generation operations work unchanged
- [ ] Typecheck passes

### US-007: Extract naming generation operations
**Description:** As a developer, I want session/thread naming operations in a dedicated file.

**Acceptance Criteria:**
- [ ] Create `stores/session/naming.ts`
- [ ] Move: `_generateName`, `generateNameAndThreadName`, `generateThreadName`
- [ ] Move: `scheduleGenerateNameAndThreadName`, `scheduleGenerateThreadName`
- [ ] Move: `modifyNameAndThreadName`, `modifyThreadName`
- [ ] Handle module-level state (choose one):
  - Option A: Create `stores/session/state.ts` for shared Maps
  - Option B: Keep Maps in naming.ts, export getters if needed elsewhere
- [ ] Update imports in sessionActions.ts to re-export
- [ ] All naming operations work unchanged
- [ ] Typecheck passes

### US-008: Extract context building operations
**Description:** As a developer, I want context/prompt building operations properly placed.

**Acceptance Criteria:**
- [ ] Evaluate placement options:
  - Option A: `stores/session/context.ts` (keeps it with session logic)
  - Option B: `packages/context-management/build-message-context.ts` (domain logic separation)
- [ ] `genMessageContext` (200+ lines) contains AI prompt logic - consider Option B
- [ ] Move: `getMessageThreadContext`
- [ ] Move: `getSessionWebBrowsing` helper
- [ ] If Option B chosen, create thin wrapper in stores/ if needed
- [ ] Update imports in generation.ts
- [ ] All context building works unchanged
- [ ] Typecheck passes

### US-009: Extract export operations
**Description:** As a developer, I want export operations in a dedicated file.

**Acceptance Criteria:**
- [ ] Create `stores/session/export.ts`
- [ ] Move: `exportSessionChat`
- [ ] Keep `exportChat` in sessionHelpers.ts (it's already there)
- [ ] Update imports in sessionActions.ts to re-export
- [ ] All export operations work unchanged
- [ ] Typecheck passes

### US-010: Create sessionActions.ts facade
**Description:** As a developer, I want sessionActions.ts to become a clean re-export facade.

**Acceptance Criteria:**
- [ ] sessionActions.ts only contains re-exports from session/ modules
- [ ] File is <50 lines
- [ ] All existing imports from sessionActions.ts still work (backward compat)
- [ ] No circular dependency issues (verify with `madge --circular`)
- [ ] Typecheck passes

### US-011: Create session module index
**Description:** As a developer, I want a clean index file for the session module.

**Acceptance Criteria:**
- [ ] Create `stores/session/index.ts`
- [ ] Export all public functions (37 total)
- [ ] Internal helpers NOT exported (prefix with `_` or keep unexported)
- [ ] Clear separation of public API vs internals
- [ ] Typecheck passes

### US-012: Reorganize chat-related components
**Description:** As a developer, I want chat-related components grouped together.

**Acceptance Criteria:**
- [ ] Create `components/chat/` directory
- [ ] Move using `git mv` for history preservation:
  - `Message.tsx` (28KB), `MessageList.tsx` (20KB), `MessageLoading.tsx`
  - `MessageNavigation.tsx`, `MessageErrTips.tsx`
  - `SummaryMessage.tsx`, `CompactionStatus.tsx`
- [ ] Consider moving `message-parts/` contents into `chat/parts/`
- [ ] Update all imports across the codebase using AST-grep or LSP rename
- [ ] All chat components render correctly
- [ ] Typecheck passes
- [ ] Verify in browser: message display, loading states, error tips work

### US-013: Reorganize session-related components
**Description:** As a developer, I want session-related components grouped together.

**Acceptance Criteria:**
- [ ] Create `components/session/` directory
- [ ] Move: `SessionList.tsx`, `SessionItem.tsx`
- [ ] Move: `ThreadHistoryDrawer.tsx`
- [ ] Update all imports across the codebase
- [ ] All session components render correctly
- [ ] Typecheck passes
- [ ] Verify in browser: session list, switching, thread drawer work

### US-014: Reorganize layout components
**Description:** As a developer, I want layout components grouped together.

**Acceptance Criteria:**
- [ ] Create `components/layout/` directory
- [ ] Move: `Header.tsx`, `Page.tsx`
- [ ] Move: `WindowControls.tsx`, `Toolbar.tsx`
- [ ] Move: `Overlay.tsx`, `ExitFullscreenButton.tsx`
- [ ] Update all imports across the codebase
- [ ] All layout components render correctly
- [ ] Typecheck passes
- [ ] Verify in browser: header, toolbar, window controls work

### US-015: Reorganize input-related components
**Description:** As a developer, I want input-related components grouped together.

**Acceptance Criteria:**
- [ ] Verify `components/InputBox/` already exists (7 files) - keep as-is
- [ ] Move: `Attachments.tsx` to `InputBox/` (it's input-related)
- [ ] Move: `TextFieldReset.tsx` to `common/`
- [ ] Update all imports across the codebase
- [ ] All input components render correctly
- [ ] Typecheck passes
- [ ] Verify in browser: file attachments, input box work

### US-016: Reorganize common/shared components
**Description:** As a developer, I want commonly reused components grouped together.

**Acceptance Criteria:**
- [ ] Create `components/common/` directory
- [ ] Move generic UI elements:
  - `Link.tsx`, `Avatar.tsx`, `MiniButton.tsx`
  - `AdaptiveModal.tsx`, `CompressionModal.tsx`, `PopoverConfirm.tsx`
  - `LazyNumberInput.tsx`, `PasswordTextField.tsx`, `CreatableSelect.tsx`
  - `Toasts.tsx`, `ErrorBoundary.tsx`
  - Slider variants: `LazySlider.tsx`, `SliderWithInput.tsx`, `TemperatureSlider.tsx`, `TopPSlider.tsx`
- [ ] Keep domain-specific components flat (evaluate case by case)
- [ ] Update all imports across the codebase
- [ ] All common components render correctly
- [ ] Typecheck passes

### US-017: Clean up types.ts
**Description:** As a developer, I want to remove dead code and commented-out definitions from types.ts.

**Acceptance Criteria:**
- [ ] Remove all commented-out type definitions (~150 lines, lines 16-250)
- [ ] Verify each removed type is properly defined in `types/session.ts`
- [ ] types.ts only contains:
  - Re-exports from `types/` subdirectory
  - Utility functions (`createMessage`, `isChatSession`, `isPictureSession`)
  - Active type aliases (`Updater`, `UpdaterFn`, etc.)
- [ ] No duplicate type definitions
- [ ] Typecheck passes

### US-018: Consolidate type definitions
**Description:** As a developer, I want all types properly organized in the types/ directory.

**Acceptance Criteria:**
- [ ] Verify `types/session.ts` contains all session-related types
- [ ] Verify `types/settings.ts` contains all settings-related types
- [ ] Verify `types/provider.ts` contains all provider-related types
- [ ] Move any orphaned types to appropriate files
- [ ] Update imports across codebase
- [ ] Typecheck passes

### US-019: Update path aliases if needed
**Description:** As a developer, I want path aliases to work correctly after reorganization.

**Acceptance Criteria:**
- [ ] Verify `@/components/...` alias works for all moved components
- [ ] Verify `@/stores/session/...` alias works for new session modules
- [ ] Update tsconfig.json paths if needed
- [ ] Update vite config if needed
- [ ] All imports resolve correctly
- [ ] Build succeeds (`npm run build`)

### US-020: Update AGENTS.md with new structure
**Description:** As a developer, I want AGENTS.md to reflect the new code organization.

**Acceptance Criteria:**
- [ ] Update project structure section with new directories
- [ ] Document `stores/session/` module structure and file responsibilities
- [ ] Document `components/` subdirectory structure
- [ ] Add guidance: "Where to add new session logic" -> `stores/session/`
- [ ] Add guidance: "Where to add new chat UI" -> `components/chat/`
- [ ] Typecheck passes

### US-021: Evaluate large components for splitting
**Description:** As a developer, I want to assess whether large components need internal restructuring.

**Acceptance Criteria:**
- [ ] Review `Message.tsx` (28KB, ~800 lines) - document findings:
  - Can message actions be extracted to `MessageActions.tsx`?
  - Can message content rendering be extracted?
- [ ] Review `MessageList.tsx` (20KB, ~550 lines) - document findings
- [ ] Review `Markdown.tsx` (17KB, ~450 lines) - document findings:
  - Can code block rendering be extracted?
  - Can Mermaid integration be extracted?
- [ ] Review `ActionMenu.tsx` (9KB) - document findings
- [ ] Create `docs/large-component-analysis.md` with recommendations
- [ ] Decision: split now vs defer to future PRD
- [ ] Typecheck passes

### US-022: Create regression test checklist
**Description:** As a developer, I want a verification plan to ensure nothing breaks.

**Acceptance Criteria:**
- [ ] Create manual QA checklist covering critical flows:
  - Session: create, switch, delete, rename, reorder
  - Messages: send, receive, edit, delete, copy
  - Threads: new thread, switch thread, compress, delete
  - Forks: create fork, navigate forks, delete fork
  - Generation: stream response, regenerate, stop generation
  - Export: export to Markdown/TXT/HTML
  - UI: sidebar toggle, fullscreen, keyboard shortcuts
- [ ] Run `npm run test` - all tests pass
- [ ] Run `npm run check` - no type errors
- [ ] Run `npm run lint` - no lint errors
- [ ] Run `npm run build` - build succeeds
- [ ] Manual smoke test in dev mode passes

## Functional Requirements

- FR-1: All existing functionality must work identically after reorganization
- FR-2: No new dependencies introduced
- FR-3: Build time must not increase significantly (<10% regression)
- FR-4: Hot reload must work correctly for moved files
- FR-5: All imports must be updated correctly (no broken imports at runtime)
- FR-6: Git history should be preserved where possible (use `git mv`)
- FR-7: No circular dependencies introduced (verify with `madge --circular src/`)

## Non-Goals

- No refactoring of logic within moved files (just reorganization)
- No changes to component implementations
- No changes to public APIs
- No TypeScript configuration changes beyond path aliases
- No new abstractions or patterns introduced
- No splitting of large components (defer to US-021 analysis)

## Technical Considerations

### Session Module Structure (Post-Refactor)

```
stores/
├── session/
│   ├── index.ts          # Public exports (37 functions)
│   ├── state.ts          # Shared module state (Maps) - if needed
│   ├── crud.ts           # Create, read, update, delete sessions (~200 lines)
│   ├── messages.ts       # Message operations (~150 lines)
│   ├── threads.ts        # Thread/history operations (~200 lines)
│   ├── forks.ts          # Message fork operations (~400 lines)
│   ├── generation.ts     # AI generation (~250 lines)
│   ├── naming.ts         # Auto-naming (~150 lines)
│   ├── context.ts        # Context building wrapper (or in packages/)
│   └── export.ts         # Export functionality (~50 lines)
├── sessionActions.ts     # Re-export facade (<50 lines, backward compat)
├── chatStore.ts          # React Query operations (unchanged)
└── ...
```

### Component Structure (Current vs Post-Refactor)

**Current State (59 flat + 43 organized):**
```
components/
├── InputBox/          (7 files)  ← Keep as-is
├── ModelSelector/     (6 files)  ← Keep as-is
├── icons/             (17 files) ← Keep as-is
├── knowledge-base/    (5 files)  ← Keep as-is
├── mcp/               (2 files)  ← Keep as-is
├── settings/          (1 file)   ← Keep as-is
├── ui/                (2 files)  ← Keep as-is
├── message-parts/     (1 file)   ← Consider merging into chat/
├── dev/               (2 files)  ← Keep as-is
└── [59 flat files]    ← Reorganize these
```

**Post-Refactor:**
```
components/
├── chat/                 # Message display (7 files from flat)
│   ├── Message.tsx
│   ├── MessageList.tsx
│   ├── MessageLoading.tsx
│   ├── MessageNavigation.tsx
│   ├── MessageErrTips.tsx
│   ├── SummaryMessage.tsx
│   ├── CompactionStatus.tsx
│   └── parts/            # Merged from message-parts/
│       └── ToolCallPartUI.tsx
├── session/              # Session management (3 files from flat)
│   ├── SessionList.tsx
│   ├── SessionItem.tsx
│   └── ThreadHistoryDrawer.tsx
├── layout/               # Page structure (6 files from flat)
│   ├── Header.tsx
│   ├── Page.tsx
│   ├── Toolbar.tsx
│   ├── WindowControls.tsx
│   ├── Overlay.tsx
│   └── ExitFullscreenButton.tsx
├── common/               # Shared components (~20 files from flat)
│   ├── Avatar.tsx
│   ├── Link.tsx
│   ├── Toasts.tsx
│   ├── ErrorBoundary.tsx
│   ├── AdaptiveModal.tsx
│   ├── PopoverConfirm.tsx
│   ├── [sliders, inputs, etc.]
│   └── ...
├── InputBox/             # (existing, +1 Attachments.tsx)
├── ModelSelector/        # (existing, keep as-is)
├── [other existing dirs] # (keep as-is)
└── [~23 remaining flat]  # Domain-specific, evaluate case by case
```

### Barrel File Decision

- **YES for `stores/session/`**: Use `index.ts` for clean public API
- **NO for `components/*/`**: Use direct imports to avoid bundler tree-shaking issues and circular deps

### Migration Strategy

1. **Phase 0**: Dependency Analysis (US-000) - BLOCKER for Phase A
   - Map all internal dependencies
   - Design shared state strategy
   - Verify no circular import risk
   
2. **Phase A**: Split sessionActions.ts (US-001 through US-011)
   - Create new files with moved functions
   - Update sessionActions.ts to re-export
   - Verify no broken imports
   - Can be done incrementally (one module per PR)
   
3. **Phase B**: Reorganize components (US-012 through US-016)
   - Create directories
   - Move files using `git mv` for history
   - Update imports using AST-grep
   - **Can run in parallel with Phase A after US-000 complete**
   
4. **Phase C**: Clean up types (US-017, US-018)
   - Remove dead code
   - Consolidate definitions
   - Depends on stable imports from A & B
   
5. **Phase D**: Documentation & Analysis (US-019 through US-022)
   - Update configs
   - Update AGENTS.md
   - Large component analysis (future work identification)

### Import Update Strategy

**Preferred: AST-based refactoring (safe, bulk updates)**

```bash
# Using ast-grep for bulk import updates
ast-grep --pattern 'from "@/components/Message"' \
         --rewrite 'from "@/components/chat/Message"' \
         --lang typescript src/

# Or using LSP rename via editor/CLI for precise refactoring
```

**Fallback: grep + manual (for edge cases)**

```bash
# Find all imports of a component
grep -r "from.*['\"]@/components/Message['\"]" src/
```

### Circular Dependency Prevention

```bash
# Install madge for dependency analysis
npm install -D madge

# Check for circular dependencies
npx madge --circular src/renderer/stores/

# Visualize dependency graph (optional)
npx madge --image graph.svg src/renderer/stores/sessionActions.ts
```

### Risk Mitigation

- Make atomic commits (one module/component move per commit)
- Run typecheck after each move (`npm run check`)
- Run tests after completing each user story (`npm run test`)
- Keep backup branch of original state until full QA
- If circular dependency detected, STOP and redesign before proceeding

## Success Metrics

- sessionActions.ts: Reduced from 1798 lines to <50 lines (facade only)
- Largest session module file: <400 lines (forks.ts may be largest)
- Flat components reduced: From 59 to ~23 (remaining are domain-specific)
- types.ts: No commented-out code (~150 lines removed)
- No circular dependencies: `madge --circular` returns empty
- All tests pass: `npm run test` green
- Build succeeds: `npm run build` completes without errors
- Developer onboarding: New developers can find code faster

## Design Decisions (Resolved)

| Question | Decision | Rationale |
|----------|----------|-----------|
| Barrel files in component dirs? | **No** | Avoid bundler tree-shaking issues, simpler imports |
| Component size limits? | **Advisory 500 lines** | Not enforced, but flagged for review |
| `components/legacy/` for misc? | **No** | Creates dumping ground; keep truly shared components flat |
| Lint rules for structure? | **Yes, after stabilization** | Add `eslint-plugin-import` rules in follow-up PR |
| Where does `genMessageContext` go? | **Evaluate in US-008** | Either `stores/session/context.ts` or `packages/context-management/` |
| Shared naming state handling? | **Decide in US-000** | Either `stores/session/state.ts` or keep in naming.ts |

## Open Questions

1. Should `message-parts/` be merged into `chat/parts/` or kept separate?
2. After US-021 analysis, should large component splitting be a separate PRD?
