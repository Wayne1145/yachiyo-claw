# 首页新会话机制文档

## 概述

Chatbox 的首页（`/`路由）是用户创建新对话的入口。本文档详细说明了新会话的创建机制，特别是临时状态的管理和转移过程。

## 核心概念

### 1. 临时会话 ID："new"

在用户真正发送第一条消息之前，首页使用一个特殊的会话 ID `"new"` 来标识这是一个尚未创建的临时会话。

```typescript
const [session, setSession] = useState<Session>({
  id: 'new',
  ...initEmptyChatSession(),
})
```

### 2. 临时状态管理：newSessionStateAtom

为了管理新会话的临时状态（如知识库选择、网页浏览模式等），系统使用了专门的 atom：

```typescript
// src/renderer/stores/atoms/uiAtoms.ts
export const newSessionStateAtom = atom<{
  knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
  webBrowsing?: boolean
}>({})
```

这个 atom 专门存储用户在发送第一条消息前的各种选择和设置。

## 工作流程

### 1. 用户交互阶段

当用户在首页进行以下操作时，状态都保存在临时存储中：

- **选择知识库**：存储在 `newSessionStateAtom.knowledgeBase`
- **选择模型**：存储在组件的 `session` state 中
- **选择 Copilot**：同样存储在组件的 `session` state 中

### 2. InputBox 组件的智能处理

InputBox 组件会根据 sessionId 智能选择存储位置：

```typescript
const isNewSession = currentSessionId === 'new'

const knowledgeBase = isNewSession 
  ? newSessionState.knowledgeBase 
  : sessionKnowledgeBaseMap[currentSessionId]

const setKnowledgeBase = useCallback((value) => {
  if (isNewSession) {
    setNewSessionState(prev => ({ ...prev, knowledgeBase: value }))
  } else {
    // 更新实际会话的知识库映射
    setSessionKnowledgeBaseMap(prev => ({
      ...prev,
      [currentSessionId]: value
    }))
  }
}, [currentSessionId, isNewSession])
```

### 3. 会话创建和状态转移

当用户发送第一条消息时，`handleSubmit` 函数执行以下步骤：

```typescript
const handleSubmit = async (payload: InputBoxPayload) => {
  // 1. 创建真正的会话
  const newSession = await createSession({
    name: session.name,
    type: 'chat',
    picUrl: session.picUrl,
    messages: session.messages,
    copilotId: session.copilotId,
    settings: session.settings,
  })

  // 2. 转移临时状态到新会话
  if (newSessionState.knowledgeBase) {
    setSessionKnowledgeBaseMap({
      ...sessionKnowledgeBaseMap,
      [newSession.id]: newSessionState.knowledgeBase,
    })
    // 清空临时状态
    setNewSessionState({})
  }

  // 3. 切换到新会话
  sessionActions.switchCurrentSession(newSession.id)

  // 4. 发送消息
  // ...
}
```

## 关键设计决策

### 1. 为什么使用 "new" 作为临时 ID？

- 简单明了，易于识别
- 避免与真实的 UUID 冲突
- 便于在代码中进行特殊处理

### 2. 为什么需要 newSessionStateAtom？

- **职责分离**：临时状态和持久状态分开管理
- **避免污染**：不会在 sessionKnowledgeBaseMap 中留下无效数据
- **易于扩展**：未来可以轻松添加更多临时状态字段

### 3. 状态转移时机

状态转移发生在会话创建成功后、切换会话之前。这确保了：
- 用户选择的设置不会丢失
- 新会话立即拥有正确的配置
- 避免了异步操作的竞态条件

## 数据流图

```
用户操作 → newSessionStateAtom (临时存储)
    ↓
发送消息 → 创建会话
    ↓
状态转移 → sessionKnowledgeBaseMap[newSessionId] (持久存储)
    ↓
清空临时状态 → newSessionStateAtom = {}
```

## 注意事项

1. **内存管理**：newSessionStateAtom 在会话创建后会被清空，避免内存泄漏
2. **并发安全**：状态转移是同步操作，避免了并发问题
3. **用户体验**：整个过程对用户透明，选择的设置会无缝延续到新会话

## 相关文件

- `/src/renderer/routes/index.tsx` - 首页组件
- `/src/renderer/components/InputBox.tsx` - 输入框组件
- `/src/renderer/stores/atoms/uiAtoms.ts` - UI 状态定义
- `/src/renderer/stores/sessionActions.ts` - 会话相关操作