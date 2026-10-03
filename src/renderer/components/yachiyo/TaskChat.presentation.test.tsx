/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Message, TaskSession } from '@shared/types'
import { forwardRef, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from '@/routes/task/$taskId'

const mocks = vi.hoisted(() => ({
  session: undefined as TaskSession | undefined,
  messageProps: vi.fn(),
  inputProps: vi.fn(),
  updateTask: vi.fn(),
  submitTask: vi.fn(),
  cancelTask: vi.fn(),
  setQueryData: vi.fn(),
  setCurrentTaskId: vi.fn(),
}))

vi.mock('@mantine/core', () => {
  const Container = ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  )
  return {
    Box: Container,
    Center: Container,
    Code: Container,
    Collapse: Container,
    Flex: Container,
    Stack: Container,
    Text: Container,
    Loader: () => null,
    ActionIcon: Container,
    Button: Container,
    ScrollArea: forwardRef<HTMLDivElement, { children: ReactNode }>(({ children }, ref) => (
      <div ref={ref}>
        <div className="mantine-ScrollArea-viewport">{children}</div>
      </div>
    )),
  }
})
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({ ...options, useParams: () => ({ taskId: 'task-1' }) }),
  useNavigate: () => vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: mocks.setQueryData }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/analytics/jk', () => ({ trackJkClickEvent: vi.fn() }))
vi.mock('@/components/common/Divider', () => ({ default: () => null }))
vi.mock('@/components/common/ScalableIcon', () => ({ ScalableIcon: () => null }))
vi.mock('@/components/chat/Message', () => ({
  default: (props: { msg: Message; readOnly?: boolean; sessionId: string }) => {
    mocks.messageProps(props)
    return <div data-testid={`message-${props.msg.id}`}>{props.msg.contentParts.length}</div>
  },
}))
vi.mock('@/components/chat/MessageAttachmentGrid', () => ({ MessageAttachmentGrid: () => null }))
vi.mock('@/components/Image', () => ({ ImageInStorage: () => null }))
vi.mock('@/components/InputBox', () => ({
  default: (props: {
    onSubmit: (payload: { constructedMessage: Message; needGenerating: boolean }) => Promise<void>
    onStopGenerating: () => void
    onReasoningStrengthChange: (strength: 'high') => Promise<void>
  }) => {
    mocks.inputProps(props)
    return (
      <>
        <button
          type="button"
          onClick={() =>
            void props.onSubmit({ constructedMessage: { id: 'new-user' } as Message, needGenerating: true })
          }
        >
          Send task
        </button>
        <button type="button" onClick={props.onStopGenerating}>
          Stop task
        </button>
        <button type="button" onClick={() => void props.onReasoningStrengthChange('high')}>
          Change reasoning
        </button>
      </>
    )
  },
}))
vi.mock('@/components/InputBox/TokenCountMenu', () => ({ default: () => null }))
vi.mock('@/components/ReasoningStrengthControl', () => ({ ReasoningStrengthControl: () => null }))
vi.mock('@/components/layout/WindowControls', () => ({ default: () => null }))
vi.mock('@/components/Markdown', () => ({
  default: () => null,
  BlockCodeCollapsedStateProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/components/task/DirectoryMenu', () => ({ default: () => null }))
vi.mock('@/components/yachiyo/AndroidAppShellContext', () => ({ useInAndroidAppShell: () => true }))
vi.mock('@/components/yachiyo/YachiyoChatLanding', () => ({ YachiyoChatLanding: () => <div>Shared chat landing</div> }))
vi.mock('@/mobile/agent-session-config', () => ({ getAgentSessionConfig: () => ({}) }))
vi.mock('@/hooks/useNeedRoomForWinControls', () => ({ default: () => ({ needRoomForMacWindowControls: false }) }))
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [] }) }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => true }))
vi.mock('@/hooks/useTaskContextTokens', () => ({ useTaskContextTokens: () => ({ totalTokens: 0 }) }))
vi.mock('@/packages/model-registry', () => ({
  useModelRegistryVersion: () => 0,
  getProviderModelContextWindowSync: () => 8192,
  getModelContextWindowSync: () => 8192,
}))
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/stores/chatStore', () => ({
  useSession: () => ({ session: { assistantAvatarKey: 'character-avatar', picUrl: 'character.png' } }),
}))
vi.mock('@/stores/lastUsedModelStore', () => ({ lastUsedModelStore: { getState: () => ({}) } }))
vi.mock('@/stores/settingActions', () => ({ getAutoGenerateTitle: () => false }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: (selector: (state: object) => unknown) => selector({}) }))
vi.mock('@/stores/taskSessionActions', () => ({
  submitTaskMessage: mocks.submitTask,
  cancelTaskGeneration: mocks.cancelTask,
  isTaskGenerating: () => false,
}))
vi.mock('@/stores/taskSessionNaming', () => ({ scheduleGenerateTaskName: vi.fn() }))
vi.mock('@/stores/taskSessionStore', () => ({
  TASK_SESSION_QUERY_KEY: 'tasks',
  taskSessionStore: { getState: () => ({ setCurrentTaskId: mocks.setCurrentTaskId }) },
  updateTaskSession: mocks.updateTask,
  useTaskSessionRecord: () => ({ data: mocks.session, isFetching: false }),
}))
vi.mock('@/stores/uiStore', () => ({ useUIStore: (selector: (state: object) => unknown) => selector({}) }))

const TaskRoute = (Route as unknown as { component: () => ReactNode }).component

describe('Android task conversation presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session = {
      id: 'task-1',
      name: 'Test task',
      workingDirectory: '/workspace',
      linkedSessionId: 'chat-1',
      settings: { provider: 'yachiyo', modelId: 'gpt-5.6-terra', reasoningStrength: 'low' },
      messages: [
        { id: 'system', role: 'system', contentParts: [{ type: 'text', text: 'Private instructions' }] },
        { id: 'user', role: 'user', contentParts: [{ type: 'text', text: 'Create a site' }] },
        {
          id: 'assistant',
          role: 'assistant',
          contentParts: [
            { type: 'text', text: 'Working on it' },
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'sandbox_bash',
              state: 'result',
              args: {},
              result: { exitCode: 0, stdout: 'done' },
            },
          ],
        },
      ],
    } as TaskSession
    mocks.updateTask.mockImplementation(async (_id, updates) => ({ ...mocks.session, ...updates }))
    mocks.submitTask.mockResolvedValue(undefined)
  })

  it('uses shared message rendering without leaking system instructions or chat-store actions', () => {
    const { container } = render(<TaskRoute />)
    expect(screen.queryByTestId('message-system')).toBeNull()
    expect(screen.getByTestId('message-user')).toBeTruthy()
    expect(screen.getByTestId('message-assistant')).toBeTruthy()
    const assistant = mocks.messageProps.mock.calls
      .map(([props]) => props)
      .find((props) => props.msg.id === 'assistant')
    expect(assistant.readOnly).toBe(true)
    expect(assistant.assistantAvatarKey).toBe('character-avatar')
    expect(assistant.msg.contentParts[1].result.stdout).toBe('done')
    expect(container.querySelector('.yachiyo-task-composer-panel')).toBeNull()
    expect(container.querySelector('.yachiyo-message-list-header-clearance')).toBeTruthy()
    expect(container.querySelector('.yachiyo-task-composer')).toBeNull()
  })

  it('keeps the ordinary chat landing visible when Agent is enabled on an empty conversation', () => {
    if (mocks.session) mocks.session.messages = []
    render(<TaskRoute />)
    expect(screen.getByText('Shared chat landing')).toBeTruthy()
    expect(screen.queryByText('Send a message to start. Choose a working directory for file access.')).toBeNull()
  })

  it('keeps submit, cancel and reasoning changes owned by the task', async () => {
    render(<TaskRoute />)
    fireEvent.click(screen.getByRole('button', { name: 'Send task' }))
    await waitFor(() =>
      expect(mocks.submitTask).toHaveBeenCalledWith(
        'task-1',
        { id: 'new-user' },
        expect.objectContaining({ needGenerating: true })
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop task' }))
    expect(mocks.cancelTask).toHaveBeenCalledWith('task-1')
    fireEvent.click(screen.getByRole('button', { name: 'Change reasoning' }))
    await waitFor(() =>
      expect(mocks.updateTask).toHaveBeenCalledWith('task-1', {
        settings: { provider: 'yachiyo', modelId: 'gpt-5.6-terra', reasoningStrength: 'high' },
      })
    )
    expect(mocks.inputProps.mock.calls[0][0].reasoningSettings.reasoningStrength).toBe('low')
  })
})
