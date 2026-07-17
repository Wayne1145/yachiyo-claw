# PRD: Chatbox Pro 上下文管理优化

## 1. Introduction/Overview

Chatbox Pro 当前的上下文管理机制较为基础，仅支持基于消息数量的截断（默认 6 条）。随着用户对话越来越长，这种方式存在以下问题：

1. **上下文丢失严重**：重要的历史信息被简单截断，AI 无法记住关键内容
2. **Token 浪费**：历史 tool 调用的完整结果占用大量 token，但对后续对话价值有限
3. **用户体验差**：达到上下文限制时，用户需要手动创建新话题

本 PRD 旨在为 chatbox-pro 实现智能上下文管理机制，参考 chatbox-agent 的 context compaction 设计，同时针对客户端特性进行优化。

## 2. Goals

1. **自动上下文压缩**：当 token 使用量接近模型上下文窗口限制时，自动生成对话摘要并压缩历史
2. **智能 tool 调用清理**：自动移除历史消息中的旧 tool 调用内容，仅保留最近 N 条
3. **动态模型适配**：根据不同模型的 contextWindow 动态调整压缩策略
4. **用户可配置**：允许用户调整压缩阈值百分比
5. **全平台支持**：Desktop、Mobile、Web 同时支持

## 3. User Stories

### US-1: 自动上下文压缩
> 作为用户，当我的对话变得很长时，我希望系统能自动压缩历史上下文，这样我可以无缝继续对话，而不需要手动创建新话题或担心 "上下文太长" 的错误。

### US-2: 查看压缩历史
> 作为用户，当系统自动压缩了我的对话历史后，我希望能像手动压缩一样，在 threads 列表中看到被归档的原始对话，以便需要时可以回顾。

### US-3: 配置压缩阈值
> 作为用户，我希望能够调整压缩触发的阈值百分比，以满足不同场景的需求（如成本敏感时降低阈值，信息保留优先时提高阈值）。

### US-4: Tool 调用优化
> 作为用户，我不希望历史中的大量搜索结果、文件读取结果等 tool 调用占用我宝贵的上下文空间，系统应该只保留最近几次的 tool 调用。

### US-5: 模型切换适配
> 作为用户，当我切换到上下文窗口较小的模型时，我希望系统能自动适应，必要时触发压缩，而不是报错。

### US-6: 未知模型配置
> 作为使用自定义模型的用户，当系统无法获取模型的 contextWindow 时，我希望能收到提示并手动配置，而不是使用错误的默认值导致问题。

## 4. Functional Requirements

### 4.1 上下文压缩机制

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | 系统必须在消息完成后检测当前 token 使用量是否超过阈值 | P0 |
| FR-1.2 | 阈值计算公式：`threshold = (contextWindow - outputReserve) * compactionThreshold`，其中 `compactionThreshold` 为用户可配置的百分比（默认 60%） | P0 |
| FR-1.3 | 当超过阈值时，系统必须使用摘要模型生成对话总结 | P0 |
| FR-1.4 | 摘要内容必须包含：已完成的任务、当前状态、关键上下文（文件路径、代码片段等）、下一步计划 | P0 |
| FR-1.5 | 压缩后，原始消息**保持不变**（用户 UI 中仍可完整查看所有历史消息） | P0 |
| FR-1.6 | 压缩后，系统必须在消息列表中**追加**一条摘要消息（`isSummary=true`），并记录压缩边界点 | P0 |
| FR-1.7 | 发送给 AI 的上下文必须**动态构建**：从最近的压缩点开始，不包含压缩点之前的消息，但包含摘要消息 | P0 |
| FR-1.8 | 每个 thread 必须维护独立的压缩状态，互不影响 | P0 |

### 4.2 Tool 调用清理

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | Tool 调用清理必须是**动态的**，不修改存储的原始消息 | P0 |
| FR-2.2 | 构建发送给 AI 的上下文时，仅保留最近 2 轮对话（2 对 user-assistant）中的 tool-call 部分 | P0 |
| FR-2.3 | 超过 2 轮对话的消息中，tool-call 部分必须被动态移除（仅保留文本内容） | P0 |
| FR-2.4 | Tool 调用清理必须在压缩检测之前执行（先清理再计算 token） | P0 |
| FR-2.5 | 用户 UI 中显示的消息必须保持完整（包含所有 tool 调用详情） | P0 |

### 4.3 模型 contextWindow 获取

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | 系统必须内置常用模型的 contextWindow 配置（基于 models.dev 数据） | P0 |
| FR-3.2 | 系统应该定期（每周）从 models.dev 获取最新模型数据并缓存 | P1 |
| FR-3.3 | 对于未知模型，系统必须使用默认值 96,000 tokens | P0 |
| FR-3.4 | 对于无法获取 contextWindow 的模型，系统必须在自动压缩开关处提示用户手动配置 | P0 |
| FR-3.5 | 模型匹配逻辑：精确匹配 modelId > 前缀匹配 > 默认值 | P0 |

### 4.4 用户配置

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | 用户必须能够在设置页面配置全局自动压缩开关（默认开启） | P0 |
| FR-4.2 | 用户必须能够在上下文预估 Modal 中配置当前会话的自动压缩开关 | P0 |
| FR-4.3 | 会话级设置优先于全局设置；未设置时使用全局设置 | P0 |
| FR-4.4 | 用户必须能够配置压缩阈值百分比（范围 40%-90%，默认 60%） | P0 |
| FR-4.5 | UI 应显示当前阈值对应的策略提示（如 40%-60% 显示"成本优先"，60%-75% 显示"平衡模式"，75%-90% 显示"信息保留"） | P1 |

### 4.5 摘要模型选择

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | ChatboxAI 后端 GetRemoteConfig 接口必须增加 `fastModel` 配置，下发推荐的快速模型 | P0 |
| FR-5.2 | ChatboxAI 用户：默认使用 RemoteConfig 下发的 `fastModel` 生成摘要（同时用于 threadNaming） | P0 |
| FR-5.3 | 非 ChatboxAI 用户：使用用户配置的 `threadNamingModel`（复用现有配置） | P0 |
| FR-5.4 | 如果未配置任何摘要模型，回退使用当前会话的模型 | P0 |

## 5. Non-Goals (Out of Scope)

1. **增量式压缩**：本版本不实现多次递进压缩（压缩摘要的摘要），每次压缩都从上次压缩点开始
2. **跨会话上下文**：不支持在不同会话间共享上下文
3. **语义重要性排序**：不实现基于语义的消息重要性判断，仅使用时间顺序
4. **实时 token 计数显示优化**：token 计数 UI 优化不在本 PRD 范围内
5. **服务端压缩**：所有压缩逻辑在客户端执行，不依赖后端服务

## 6. Design Considerations

### 6.1 数据结构变更

```typescript
// SessionThread 扩展（每个 thread 独立的压缩状态）
interface SessionThread {
  // ... existing fields (id, name, messages, createdAt)
  compactionPoints?: CompactionPoint[]  // 该 thread 的压缩点列表
}

// Session 扩展（当前活跃 thread 的压缩状态）
interface Session {
  // ... existing fields
  compactionPoints?: CompactionPoint[]  // 当前 thread 的压缩点列表
}

// 压缩点记录
interface CompactionPoint {
  summaryMessageId: string    // 摘要消息的 ID
  boundaryMessageId: string   // 压缩边界：此 ID 之前的消息不再发送给 AI
  createdAt: number           // 压缩时间
}

// Message 扩展
interface Message {
  // ... existing fields
  isSummary?: boolean      // 标记为压缩摘要消息
}
```

**设计说明**：

1. **存储不变原则**：原始消息保持完整存储，用户可在 UI 中查看所有历史
2. **压缩点列表**：支持多次压缩，每次压缩记录一个点
3. **动态构建上下文**：发送给 AI 时，从最近压缩点的 `boundaryMessageId` 之后开始，并包含对应的摘要消息

### 6.2 设置项扩展

```typescript
// 全局设置
interface Settings {
  // ... existing fields
  
  // 上下文管理配置（全局默认）
  autoCompaction?: boolean           // 是否启用自动压缩，默认 true
  compactionThreshold?: number       // 压缩阈值百分比，范围 0.4-0.9，默认 0.6
  
  // threadNamingModel 已存在，复用于摘要生成
  // threadNamingModel?: { provider: string; model: string }
}

// 会话设置（覆盖全局）
interface SessionSettings {
  // ... existing fields
  
  // 会话级上下文管理配置（可选，未设置时使用全局）
  autoCompaction?: boolean | undefined  // undefined = 使用全局设置
}

// RemoteConfig 扩展（后端下发）
interface RemoteConfig {
  // ... existing fields
  fastModel?: {                      // 快速模型配置，用于 threadNaming 和压缩摘要
    provider: string
    model: string
  }
}
```

### 6.3 UI 变更

#### 6.3.1 上下文预估 Modal（InputBox 内）

用户悬浮（Desktop）或触摸（Mobile）InputBox 内的上下文预估数字时，显示上下文预估详情 Modal。在此 Modal 中增加自动压缩开关：

```
┌─────────────────────────────────────────────────────────┐
│ 上下文预估                                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 当前上下文: 45,230 tokens                               │
│ 模型上限:   128,000 tokens                              │
│ 使用率:     35.3%                                       │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ [压缩上下文]        自动压缩 [●] (本会话)               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

| 状态 | 显示 |
|------|------|
| 正常可用 | 开关 + "自动压缩 (本会话)" |
| 无 contextWindow | 开关禁用 + Tooltip: "当前模型未配置上下文窗口，请在设置中配置" |
| 压缩进行中 | 开关禁用 + "正在压缩..." |
| 使用全局设置 | 开关状态跟随全局，可点击切换为会话独立设置 |

#### 6.3.2 设置页面（完整配置）

在 "Chat" 或 "Advanced" tab 添加 "上下文管理" 配置区域：

```
┌─────────────────────────────────────────────────────────┐
│ 上下文管理                                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 自动压缩（全局默认）                                     │
│ [●] 开启                                                │
│ 当对话上下文接近模型限制时，自动生成摘要并压缩历史消息    │
│ 单个会话可在上下文预估面板中覆盖此设置                   │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ 压缩阈值                                                │
│ [====●==========] 60%                                   │
│ 成本优先 ←─────────────────────────────→ 信息保留       │
│ 当前策略: 平衡模式 - 在成本和上下文间取得平衡            │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ 摘要模型                                                │
│ [使用默认模型 ▼]                                        │
│ ChatboxAI 用户使用系统推荐模型，其他用户可自定义         │
│ （此设置同时影响自动生成话题名称功能）                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

配置项说明：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| 自动压缩（全局） | 开关 | **开启** | 全局默认开关，会话可覆盖 |
| 压缩阈值 | 滑块 | 60% | 范围 40%-90%，步长 5% |
| 摘要模型 | 下拉 | 使用默认模型 | 可选择已配置的模型 |

#### 6.3.3 策略提示映射

| 阈值范围 | 策略名称 | 描述 |
|----------|----------|------|
| 40%-60% | 成本优先 | 更频繁压缩，节省 token 消耗 |
| 60%-75% | 平衡模式 | 在成本和上下文保留间取得平衡 |
| 75%-90% | 信息保留 | 尽可能保留更多上下文信息 |

#### 6.3.4 压缩状态提示

压缩进行时在消息区域顶部显示状态条："正在优化上下文..."

## 7. Technical Considerations

### 7.1 依赖关系

- 复用现有 `token.ts` 的 token 估算逻辑
- 复用现有 `compressAndCreateThread` 函数的 thread 创建逻辑
- 复用现有 `streamText` / `generateText` 调用摘要模型
- 复用现有 `threadNamingModel` 配置

### 7.2 models.dev 集成

```typescript
// 内置模型数据示例（构建时生成）
const BUILTIN_MODEL_CONTEXT: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-3.5-turbo': 16_385,
  'claude-3-5-sonnet': 200_000,
  'claude-3-opus': 200_000,
  'claude-3-haiku': 200_000,
  'gemini-1.5-pro': 1_000_000,
  'gemini-1.5-flash': 1_000_000,
  // ... more models
}

// 默认值（未知模型）
const DEFAULT_CONTEXT_WINDOW = 96_000

// 运行时更新缓存
async function updateModelContextCache() {
  try {
    const data = await fetch('https://models.dev/api/models')
    // 存储到 localStorage，设置 7 天过期
    localStorage.setItem('modelContextCache', JSON.stringify({
      data,
      expiry: Date.now() + 7 * 24 * 60 * 60 * 1000
    }))
  } catch (e) {
    // 静默失败，使用内置数据
  }
}

// 获取模型 contextWindow
function getModelContextWindow(modelId: string): number | null {
  // 1. 精确匹配
  if (BUILTIN_MODEL_CONTEXT[modelId]) return BUILTIN_MODEL_CONTEXT[modelId]
  
  // 2. 缓存匹配
  const cached = getCachedModelData(modelId)
  if (cached?.contextWindow) return cached.contextWindow
  
  // 3. 前缀匹配
  for (const [key, value] of Object.entries(BUILTIN_MODEL_CONTEXT)) {
    if (modelId.startsWith(key)) return value
  }
  
  // 4. 返回 null 表示未知，由调用方决定是否使用默认值或提示用户
  return null
}
```

### 7.3 Thread 独立压缩状态

```typescript
// 切换 thread 时的状态处理
async function switchThread(sessionId: string, threadId: string) {
  const session = await getSession(sessionId)
  
  // 保存当前 thread 的压缩状态到 threads 数组
  if (session.threads) {
    const currentThread = session.threads.find(t => t.id === currentThreadId)
    if (currentThread) {
      currentThread.lastCompactionMessageId = session.lastCompactionMessageId
      currentThread.compactionCount = session.compactionCount
    }
  }
  
  // 加载目标 thread 的压缩状态
  const targetThread = session.threads?.find(t => t.id === threadId)
  session.lastCompactionMessageId = targetThread?.lastCompactionMessageId
  session.compactionCount = targetThread?.compactionCount ?? 0
  
  // ... rest of switch logic
}
```

### 7.4 平台差异

| 平台 | 差异点 |
|------|--------|
| Desktop | 完整功能支持 |
| Web | 完整功能支持，models.dev 请求可能需要处理 CORS |
| Mobile | 完整功能支持，注意后台任务可能被系统中断 |

### 7.5 性能考虑

1. **压缩时机**：在消息生成完成后异步执行，不阻塞 UI
2. **摘要生成**：使用流式输出，让用户看到进度
3. **Token 计算缓存**：消息的 token 数应缓存在 `tokenCountMap` 中

### 7.6 后端接口变更

```typescript
// chatbox-backend: GetRemoteConfig 响应扩展
interface RemoteConfigResponse {
  // ... existing fields
  fast_model?: {
    provider: string    // e.g., "chatbox-ai"
    model: string       // e.g., "chatboxai-3.5" 或快速模型
  }
}
```

## 8. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| 上下文溢出错误率 | 减少 90% | 统计 "context too long" 相关错误 |
| 平均会话长度 | 增加 50% | 统计每个会话的消息数量 |
| 自动压缩触发次数 | 正常增长 | 统计 compactionCount |
| 用户手动清理频率 | 减少 70% | 统计 startNewThread 调用 |
| 摘要质量满意度 | > 80% | 用户反馈（后续迭代） |

## 9. Open Questions

1. **摘要 prompt 模板**：需要设计一个通用的摘要 prompt，既能保留关键信息又不会过长。是否需要针对不同语言（中/英）准备不同模板？

2. **models.dev API 稳定性**：models.dev 是否有稳定的 API？是否需要备选数据源？

3. **压缩失败处理**：如果摘要模型调用失败，应该如何处理？是否回退到简单截断？

4. **~~多轮 tool 调用~~**：已确定按对话轮次（2 轮 user-assistant）清理，而非按 tool 调用数量

5. **图片消息处理**：包含图片的消息在压缩时如何处理？是否需要将图片转为文字描述？

---

## Appendix A: 参考实现

### chatbox-pro 上下文构建流程

```
发送消息给 AI 时的上下文构建流程：

1. 获取所有消息: getAllMessages(session)
2. 查找最近压缩点: getLatestCompactionPoint(session)
3. 截断历史消息: 
   - 如果有压缩点，从 boundaryMessageId 之后开始
   - 在开头插入对应的摘要消息
4. 清理 Tool 调用:
   - 计算最近 2 轮对话的边界
   - 动态移除更早消息中的 tool-call parts（不修改存储）
5. 计算 token 并检测是否需要压缩
6. 发送给 AI
```

### chatbox-pro 压缩执行流程

```
当检测到需要压缩时：

1. 检测溢出: isOverflow({ tokens, modelId, threshold })
2. 确定压缩范围: 从上次压缩点到当前最新消息
3. 生成摘要: generateSummary(messages, summaryModel)
4. 追加摘要消息: 
   - 在消息列表末尾追加 summary message (isSummary=true)
   - 记录新的压缩点 { summaryMessageId, boundaryMessageId }
5. 用户 UI: 所有历史消息保持可见，摘要消息有特殊样式
6. 后续对话: 自动使用新的压缩点构建上下文
```

### Token 阈值计算示例

```typescript
// 模型上下文窗口
const contextWindow = 200_000  // claude-3-5-sonnet

// 预留输出空间
const outputReserve = 32_000

// 可用上下文
const usableContext = contextWindow - outputReserve  // 168,000

// 用户配置的压缩阈值（默认 60%）
const compactionThreshold = settings.compactionThreshold ?? 0.6

// 触发阈值
const threshold = usableContext * compactionThreshold  // 100,800

// UI 显示的策略提示
function getStrategyLabel(threshold: number): string {
  if (threshold <= 0.6) return '成本优先'
  if (threshold <= 0.75) return '平衡模式'
  return '信息保留'
}
```

### 上下文构建示例

```typescript
/**
 * 构建发送给 AI 的上下文（动态处理，不修改存储）
 */
function buildContextForAI(session: Session, allMessages: Message[]): Message[] {
  const context: Message[] = []
  
  // 1. 获取最近的压缩点
  const latestCompaction = session.compactionPoints?.at(-1)
  
  // 2. 确定起始位置
  let startIndex = 0
  if (latestCompaction) {
    // 找到压缩边界消息的索引
    const boundaryIndex = allMessages.findIndex(
      m => m.id === latestCompaction.boundaryMessageId
    )
    if (boundaryIndex >= 0) {
      startIndex = boundaryIndex + 1  // 从边界之后开始
    }
    
    // 插入摘要消息
    const summaryMessage = allMessages.find(
      m => m.id === latestCompaction.summaryMessageId
    )
    if (summaryMessage) {
      context.push(summaryMessage)
    }
  }
  
  // 3. 添加压缩点之后的消息
  const recentMessages = allMessages.slice(startIndex)
  
  // 4. 动态清理 tool 调用（保留最近 2 轮对话）
  const cleanedMessages = cleanToolCalls(recentMessages, 2)
  
  context.push(...cleanedMessages)
  return context
}

/**
 * 清理超过 N 轮对话的 tool 调用（动态处理，不修改原消息）
 */
function cleanToolCalls(messages: Message[], keepRounds: number): Message[] {
  // 从后往前计算轮次（一轮 = 一对 user + assistant）
  let roundCount = 0
  let roundBoundaryIndex = messages.length
  
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      roundCount++
      if (roundCount > keepRounds) {
        roundBoundaryIndex = i
        break
      }
    }
  }
  
  // 清理边界之前的消息中的 tool-call parts
  return messages.map((msg, index) => {
    if (index < roundBoundaryIndex && msg.contentParts) {
      const cleanedParts = msg.contentParts.filter(
        part => part.type !== 'tool-call'
      )
      // 如果有变化，返回新对象（不修改原消息）
      if (cleanedParts.length !== msg.contentParts.length) {
        return { ...msg, contentParts: cleanedParts }
      }
    }
    return msg
  })
}
```

## Appendix B: 配置示例

### 默认配置

```typescript
// 全局默认配置
const DEFAULT_CONTEXT_MANAGEMENT = {
  autoCompaction: true,         // 全局默认开启
  compactionThreshold: 0.6,     // 60% 阈值
}

// 会话级配置
// session.settings.autoCompaction:
//   - undefined: 使用全局设置
//   - true: 强制开启
//   - false: 强制关闭
```

### 上下文预估 Modal UI 示意

```
// 正常状态
┌─────────────────────────────────────────────────────────┐
│ 上下文预估                                         [×] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 当前上下文    45,230 tokens                             │
│ 模型上限      128,000 tokens                            │
│ 使用率        ████████░░░░░░░░░░░░░░ 35.3%             │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ [压缩上下文]              自动压缩 (本会话) [●]        │
│                                                         │
└─────────────────────────────────────────────────────────┘

// 无 contextWindow 时
┌─────────────────────────────────────────────────────────┐
│ 上下文预估                                         [×] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 当前上下文    45,230 tokens                             │
│ 模型上限      未知                                      │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ [压缩上下文]              自动压缩 (本会话) [○]        │
│                           ↑                             │
│              ┌────────────────────────────────┐         │
│              │ 当前模型未配置上下文窗口        │         │
│              │ 请在设置中配置后启用自动压缩    │         │
│              └────────────────────────────────┘         │
└─────────────────────────────────────────────────────────┘

// 会话开关状态说明
- [●] 开启：本会话启用自动压缩（可能跟随全局或独立设置）
- [○] 关闭：本会话禁用自动压缩
- 点击开关可在 "跟随全局" / "强制开启" / "强制关闭" 间切换
```
