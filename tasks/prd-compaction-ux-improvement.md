# PRD: Session Compaction UX Improvement

## Introduction

改进 session 自动压缩（Compaction）的用户体验。当前压缩在助手回复后静默执行，过程对用户不可见，且压缩点只能查看不能删除。本次改进将压缩触发时机调整为用户发送消息时，压缩过程在对话界面可见，并支持删除最新的摘要消息。

**Phase 2 补充**：解决 Phase 1 实现中发现的以下问题：
- 草稿清除时机不正确（应在压缩完成后、用户消息发送前清除）
- 删除菜单位置不合理（应在摘要内容下方 hover 显示，而非压缩分割线上）
- 压缩状态展示样式需要优化（统一自动/手动压缩，在消息列表底部展示）

**Phase 3 Bugfix**：修复自动压缩永远不会触发的 bug（待确认根因）

## Goals

- 将压缩触发时机从"助手回复后"改为"用户发送消息时"
- 压缩过程在对话界面中可见，复用现有手动压缩的滚动文字效果
- 支持删除最新的摘要消息（级联删除对应的压缩点）
- 压缩采用阻塞式流程：压缩完成后再发送用户消息
- 草稿清空时机调整为压缩成功后、用户消息发送前
- **[Phase 2]** 统一自动/手动压缩的展示组件
- **[Phase 2]** 压缩状态在消息列表底部展示（随消息滚动）
- **[Phase 2]** 删除菜单使用与普通消息一致的 hover 显示方式

## User Stories

### Phase 1 (已完成)

### US-001: Relocate compaction trigger point ✅
**Description:** As a developer, I need to move the compaction check from after AI response to before message sending, so that compaction happens at the right time.

**Acceptance Criteria:**
- [x] Remove `scheduleCompactionCheck` call from `generate` function end (sessionActions.ts:892)
- [x] Add compaction check before message sending in the send flow
- [x] Compaction runs synchronously (await) before proceeding with message send
- [x] Typecheck passes
- [x] Existing tests pass

### US-002: Add compaction UI state management ✅
**Description:** As a developer, I need to track compaction status in UI state, so that components can react to compaction progress.

**Acceptance Criteria:**
- [x] Create `compactionUIState` atom per session: `{ status: 'idle' | 'running' | 'failed', error: string | null }`
- [x] State is not persisted (memory only, resets to 'idle' on refresh)
- [x] State transitions: idle → running → idle/failed
- [x] Typecheck passes

### US-003: Display compaction progress indicator ✅
**Description:** As a user, I want to see when compaction is happening in the chat, so that I understand why sending is delayed.

**Acceptance Criteria:**
- [x] New `CompactionProgressIndicator` component renders at message list bottom when `status === 'running'`
- [x] Reuse scrolling text effect from existing `CompressionModal`
- [x] Component is pure UI (not stored in messages array)
- [x] Indicator disappears when compaction completes
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-004: Display compaction error state ✅
**Description:** As a user, I want to see error information when compaction fails, so that I can retry.

**Acceptance Criteria:**
- [x] When `status === 'failed'`, show error message and "Retry" button in indicator
- [x] Error state is pure UI (disappears on page refresh)
- [x] Clicking "Retry" sets status to 'running' and re-executes compaction
- [x] No "Skip" option - compaction must succeed to send
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-005: Disable input during compaction ✅
**Description:** As a user, I need the input to be disabled during compaction, so that I don't accidentally modify my message.

**Acceptance Criteria:**
- [x] Input textarea is disabled (readonly) when `compactionStatus === 'running'`
- [x] Send button is disabled when `compactionStatus === 'running'`
- [x] Draft content remains in input (not cleared until compaction succeeds)
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-006: Adjust draft clearing logic ✅
**Description:** As a developer, I need to change when the draft is cleared, so that failed compaction doesn't lose user's message.

**Acceptance Criteria:**
- [x] Draft is NOT cleared when user clicks send
- [x] Draft is cleared only AFTER compaction succeeds (or if no compaction needed)
- [x] On compaction failure, draft remains intact in input box
- [x] Typecheck passes

### US-007: Handle session switch during compaction ✅
**Description:** As a user, I can switch sessions while compaction is running without losing the compaction progress.

**Acceptance Criteria:**
- [x] Compaction continues in background when user switches session
- [x] When returning to the session, UI reflects current compaction status
- [x] Typecheck passes

### US-008: Add delete option for summary messages ✅
**Description:** As a user, I want to delete summary messages, so that I can undo unwanted compaction.

**Acceptance Criteria:**
- [x] Summary messages (`isSummary: true`) show "Delete" option in context menu
- [x] Only the LATEST summary message shows delete option (others hide it or disable)
- [x] Menu label is "Delete" (not "Delete compaction point" - user-friendly)
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-009: Implement summary message deletion logic ✅
**Description:** As a developer, I need to handle summary message deletion with cascade delete of compaction point.

**Acceptance Criteria:**
- [x] Deleting summary message also removes corresponding entry from `session.compactionPoints`
- [x] Original messages covered by deleted compaction point are restored to context calculation
- [x] Typecheck passes
- [x] Existing tests pass

### US-010: Add delete confirmation dialog ✅
**Description:** As a user, I want to confirm before deleting a summary, so that I understand the consequences.

**Acceptance Criteria:**
- [x] Confirmation dialog appears before deletion
- [x] Dialog explains: "Deleting this summary will restore original messages to context calculation"
- [x] Dialog has "Cancel" and "Delete" buttons
- [x] No mention of "compaction point" terminology
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

---

### Phase 2 (待实现)

### US-011: Fix draft clearing timing
**Description:** As a user, I want my draft to be cleared at the right time (after compaction, before user message is sent), so that my input doesn't remain in the box after sending.

**Acceptance Criteria:**
- [ ] Modify `submitNewUserMessage` to accept `onUserMessageReady` callback parameter
- [ ] Callback is invoked after compaction completes, before user message is inserted
- [ ] `InputBox.handleSubmit` passes callback that clears draft and resets state
- [ ] Compaction failure still keeps draft intact (callback not called)
- [ ] When no compaction needed, callback is called immediately before message insert
- [ ] Typecheck passes

### US-012: Relocate delete menu to summary content area
**Description:** As a user, I want the delete menu to appear below the summary content on hover, consistent with regular message behavior.

**Acceptance Criteria:**
- [ ] Remove ActionMenu from summaryBadge (the compaction divider line)
- [ ] Add action buttons area below expanded summary content
- [ ] Use `group/summary` + `group-hover/summary:opacity-100 opacity-0` for hover visibility
- [ ] Include "Delete" button (same as before, only for latest summary)
- [ ] Menu style consistent with Message component's action buttons
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-013: Create unified CompactionStatus component
**Description:** As a developer, I need a unified component to display compaction status that works for both auto and manual compaction.

**Acceptance Criteria:**
- [ ] Create new `CompactionStatus.tsx` component
- [ ] Component displays: running state (with streaming text), failed state (with retry), success state
- [ ] Fixed height (60px) with scrolling text showing last 3 lines (reuse `CompressionModal` approach)
- [ ] Component subscribes to `compactionUIState` atom for status and streaming text
- [ ] Typecheck passes

### US-014: Add streaming text support to compaction state
**Description:** As a developer, I need to track streaming output text during compaction for display in the UI.

**Acceptance Criteria:**
- [ ] Add `streamingText: string` field to `compactionUIState` atom
- [ ] Modify `runCompactionWithUIState` to use `streamText` instead of `generateText`
- [ ] Update `streamingText` in atom on each chunk received
- [ ] Clear `streamingText` when compaction completes or fails
- [ ] Typecheck passes

### US-015: Integrate CompactionStatus into MessageList
**Description:** As a user, I want to see compaction status at the bottom of the message list, so it scrolls with messages.

**Acceptance Criteria:**
- [ ] Render `CompactionStatus` after the last message in Virtuoso list
- [ ] Component appears only when `status !== 'idle'`
- [ ] Position is below last message (scrolls with content, not fixed)
- [ ] Remove `CompactionProgressIndicator` from `session/$sessionId.tsx`
- [ ] Delete old `CompactionProgressIndicator.tsx` file
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-016: Update manual compression to use unified flow
**Description:** As a user, I want manual compression to use the same display as auto compression after I confirm.

**Acceptance Criteria:**
- [ ] `CompressionModal` keeps confirmation step (show warning, Cancel/Confirm buttons)
- [ ] After user clicks "Confirm", modal closes immediately
- [ ] Call `runCompactionWithUIState` with `force: true` to trigger compaction
- [ ] `CompactionStatus` in MessageList takes over the display
- [ ] Remove streaming text display from `CompressionModal` (only keep confirmation UI)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### Phase 3 Bugfix (Critical) ✅

### US-017: Fix auto-compaction never triggers ✅
**Description:** As a user, I expect auto-compaction to trigger correctly when my conversation exceeds the token threshold. Currently it never triggers.

**Root Cause Analysis:**
`compaction-detector.ts` 使用 `getModelContextWindowSync(modelId)` 从 builtin-data 获取 contextWindow，但 UI 显示的是从 provider settings（ChatboxAI API 返回）获取的 `modelInfo.contextWindow`。

例如 DeepSeek V3.2：
- builtin-data 返回 128K（通过 `deepseek-v3` 前缀匹配）
- provider settings 返回 64K（ChatboxAI API 实际值）

导致：
- UI 显示阈值基于 64K：25K tokens > 19.2K 阈值 → 应触发压缩
- 压缩检测基于 128K：25K tokens < 57.6K 阈值 → 不触发压缩

**Solution:**
修改 `checkOverflow()` 接受可选 `contextWindow` 参数，优先使用 provider settings 中的值，fallback 到 builtin-data。

**Acceptance Criteria:**
- [x] `OverflowCheckOptions` 添加可选 `contextWindow` 字段
- [x] `checkOverflow()` 优先使用传入的 `contextWindow`，未提供时 fallback 到 `getModelContextWindowSync()`
- [x] `getCompactionThresholdTokens()` 同样支持可选 `contextWindow` 参数
- [x] 新增 `getModelContextWindowFromSettings()` 辅助函数从 provider settings 获取 contextWindow
- [x] `needsCompaction()` 使用 `getModelContextWindowFromSettings()` 获取并传入 contextWindow
- [x] `runCompaction()` 同样传入正确的 contextWindow
- [x] 单元测试覆盖新的 contextWindow override 功能
- [x] Playwright 验证：DeepSeek V3.2 25K tokens 会话正确触发压缩

## Functional Requirements

### Phase 1 (已完成)
- FR-1: ✅ Move compaction check from `generate` function end to before message sending
- FR-2: ✅ Compaction runs synchronously (blocking) - message sends only after compaction completes
- FR-3: ✅ Add `compactionUIState` atom with `status` and `error` fields (per session, not persisted)
- FR-4: ✅ Display `CompactionProgressIndicator` at message list bottom during compaction
- FR-5: ✅ Reuse scrolling text effect from `CompressionModal` for progress display
- FR-6: ✅ Show error state with "Retry" button on compaction failure (no skip option)
- FR-7: ✅ Disable input textarea and send button during compaction
- FR-8: ✅ Clear draft only after compaction succeeds (not on send click)
- FR-9: ✅ Allow session switching during compaction without interrupting background compaction
- FR-10: ✅ Add "Delete" menu option to summary messages (latest only)
- FR-11: ✅ Cascade delete: removing summary message also removes corresponding compaction point
- FR-12: ✅ Show confirmation dialog before deleting summary message

### Phase 2 (待实现)
- FR-13: `submitNewUserMessage` accepts `onUserMessageReady` callback, invoked after compaction before message insert
- FR-14: Draft clearing happens via callback (after compaction, before message send)
- FR-15: Delete menu moves from summary badge to expanded content area with hover visibility
- FR-16: Create unified `CompactionStatus` component replacing `CompactionProgressIndicator`
- FR-17: Add `streamingText` field to `compactionUIState` for real-time output display
- FR-18: Change auto-compaction from `generateText` to `streamText` for streaming output
- FR-19: `CompactionStatus` renders inside MessageList (scrolls with messages), not above InputBox
- FR-20: Manual compression (`CompressionModal`) triggers unified compaction flow after confirmation
- FR-21: `CompressionModal` only shows confirmation UI, streaming display delegated to `CompactionStatus`

### Phase 3 Bugfix (Critical) ✅
- FR-22: ✅ `checkOverflow()` 支持可选 `contextWindow` 参数，优先使用传入值
- FR-23: ✅ `needsCompaction()` 和 `runCompaction()` 从 provider settings 获取 contextWindow 并传入 `checkOverflow()`
- FR-24: ✅ 新增 `getModelContextWindowFromSettings()` 辅助函数从 `settings.providers[providerId].models` 获取 contextWindow

## Non-Goals

- No compression progress percentage display
- No compression history view
- No compression algorithm optimization
- No "Skip compression" option on failure
- No cancel option during compression (must wait for completion or failure)
- No changes to compression prompt (`summarizeConversation` remains unchanged)

## Technical Considerations

### Phase 1 Affected Files (已完成)
- `src/renderer/stores/sessionActions.ts` - Move compaction trigger, adjust send flow
- `src/renderer/packages/context-management/compaction.ts` - Ensure `runCompaction` returns Promise for await
- `src/renderer/stores/atoms/compactionAtoms.ts` - Add `compactionUIState` atom
- `src/renderer/components/CompactionProgressIndicator.tsx` - New progress indicator component
- `src/renderer/components/InputBox/InputBox.tsx` - Disable state based on compaction status
- `src/renderer/components/SummaryMessage.tsx` - Add delete menu to summary messages
- `src/renderer/components/MessageList.tsx` - Handle summary message rendering

### Phase 2 Affected Files (待实现)
- `src/renderer/stores/sessionActions.ts` - Add `onUserMessageReady` callback to `submitNewUserMessage`
- `src/renderer/stores/atoms/compactionAtoms.ts` - Add `streamingText` field
- `src/renderer/packages/context-management/compaction.ts` - Change to `streamText`, add streaming callback
- `src/renderer/components/InputBox/InputBox.tsx` - Update `onSubmit` type, pass callback for draft clearing
- `src/renderer/components/SummaryMessage.tsx` - Relocate delete menu to content area with hover
- `src/renderer/components/CompactionStatus.tsx` - **New**: Unified compaction status component
- `src/renderer/components/MessageList.tsx` - Integrate `CompactionStatus` at list bottom
- `src/renderer/components/CompressionModal.tsx` - Simplify to confirmation-only, delegate display
- `src/renderer/routes/session/$sessionId.tsx` - Remove `CompactionProgressIndicator`, update `onSubmit`
- `src/renderer/components/CompactionProgressIndicator.tsx` - **Delete**: Replaced by `CompactionStatus`

### Phase 3 Bugfix Affected Files ✅
- `src/renderer/packages/context-management/compaction-detector.ts` - 添加 `contextWindow` 参数支持
- `src/renderer/packages/context-management/compaction.ts` - 添加 `getModelContextWindowFromSettings()` 辅助函数，修改 `needsCompaction()` 和 `runCompaction()`
- `src/renderer/packages/context-management/compaction-detector.test.ts` - 新增 contextWindow override 测试用例

### Reusable Components
- Scrolling text effect from `CompressionModal` (last 3 lines, fixed height 60px)
- Existing message context menu infrastructure
- Existing confirmation dialog component
- `MessageActionIcon` component for hover action buttons

### State Management
- `compactionUIState` should be a Jotai atom keyed by sessionId
- State is memory-only, not persisted to storage
- State shape: `{ status: 'idle' | 'running' | 'failed', error: string | null, streamingText: string }`

### Data Flow (Phase 2 + Phase 3 Bugfix)
```
User clicks Send
    ↓
InputBox.handleSubmit
    ↓
onSubmit({ constructedMessage, needGenerating, onUserMessageReady })
    ↓
submitNewUserMessage(sessionId, { newUserMsg, ... })
    ↓
Get model's contextWindow from settings (modelInfo.contextWindow)  ← Phase 3 fix
    ↓
runCompactionWithUIState(sessionId, { contextWindow })  ← Phase 3 fix: 传入正确的 contextWindow
    ├── needsCompaction(sessionId, { contextWindow })
    │   └── checkOverflow({ tokens, modelId, contextWindow })  ← Phase 3 fix: 使用传入的 contextWindow
    ├── If (tokens > threshold): execute compaction
    │   ├── Updates compactionUIState.status = 'running'
    │   ├── streamText with onChunk callback
    │   │   └── Updates compactionUIState.streamingText
    │   ├── On success: status = 'idle', streamingText = ''
    │   └── On failure: status = 'failed', error = message
    └── If (tokens <= threshold): skip compaction
    ↓
onUserMessageReady callback → InputBox clears draft
    ↓
insertMessage (user message)
    ↓
generate (if needGenerating)
```

## Success Metrics

### Phase 1 (已完成)
- ✅ User can see compaction progress in chat interface
- ✅ Compaction failure does not lose user's draft message
- ✅ User can delete unwanted summary messages
- ✅ No regression in normal message sending flow (when compaction not needed)

### Phase 2
- Draft is cleared at correct timing (after compaction, before message appears)
- Delete menu appears in expected location (below summary content, on hover)
- Auto and manual compression have consistent visual experience
- Compaction status scrolls with message list (not fixed position)
- Streaming text visible during compression (both auto and manual)

## Open Questions

- None - all questions resolved during design discussion

## Changelog

- **2026-01-22 (3)**: Phase 3 Bugfix completed:
  - Root cause confirmed: `compaction-detector` 使用 builtin-data 的 contextWindow（如 DeepSeek V3.2 匹配到 128K），而 UI 使用 provider settings 的 contextWindow（64K），导致阈值计算不一致
  - Fix: `checkOverflow()` 添加可选 `contextWindow` 参数，`needsCompaction()` 和 `runCompaction()` 从 provider settings 获取并传入
  - Verified: Playwright 测试确认 25K tokens 的 DeepSeek V3.2 会话正确触发压缩
- **2026-01-22 (2)**: Added Phase 3 Bugfix for critical issue where auto-compaction never triggers:
  - Root cause: `compaction-detector` 只使用 `getModelContextWindowSync(modelId)` 获取 contextWindow，没有使用用户配置的 `modelInfo.contextWindow`
  - 当模型不在 builtin-data 中时，`getModelContextWindowSync` 返回 null，导致 `checkOverflow` 直接返回 `isOverflow: false`
  - US-017: Fix compaction check to use correct contextWindow source
  - FR-22~FR-24: New functional requirements for the fix
- **2026-01-22**: Phase 1 completed. Added Phase 2 to address UX issues found during review:
  - US-011: Fix draft clearing timing (callback-based approach)
  - US-012: Relocate delete menu to summary content area
  - US-013~US-016: Unify compaction status display (auto + manual)
