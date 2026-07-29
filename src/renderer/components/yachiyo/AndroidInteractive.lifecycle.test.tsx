/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AndroidInteractive } from './AndroidInteractive'

const mocks = vi.hoisted(() => ({
  getUserMedia: vi.fn(),
  recognizeAndroidSpeech: vi.fn(),
  stopAndroidSpeechRecognition: vi.fn(),
  stopSpeaking: vi.fn(),
  createEmpty: vi.fn(),
  registerCameraCaptureProvider: vi.fn(),
  unregisterCameraCaptureProvider: vi.fn(),
  translate: (key: string) => key,
}))

vi.mock('@mantine/core', () => ({
  ActionIcon: ({
    children,
    color: _color,
    variant: _variant,
    ...props
  }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & { color?: string; variant?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Button: ({ children, leftSection, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { leftSection?: ReactNode }) => (
    <button type="button" {...props}>
      {leftSection}
      {children}
    </button>
  ),
  FileButton: ({ children }: { children: (props: object) => ReactNode }) => children({}),
  Loader: () => <span>loading</span>,
  SegmentedControl: () => <div />,
  Select: () => <select />,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Textarea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  UnstyledButton: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))
vi.mock('@shared/types', () => ({
  createMessage: (_role: string, text: string) => ({ text }),
  ModelProviderEnum: { Yachiyo: 'yachiyo', Local: 'local' },
}))
vi.mock('@shared/utils/message', () => ({ getMessageText: () => '' }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.translate }) }))
vi.mock('@/components/common/AdaptiveModal', () => ({ AdaptiveModal: () => null }))
vi.mock('@/components/ReasoningStrengthControl', () => ({ ReasoningStrengthControl: () => null }))
vi.mock('@/components/icons/ProviderImageIcon', () => ({ default: () => null }))
vi.mock('@/components/ModelSelector', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [] }) }))
vi.mock('@/mobile/agent-session-config', () => ({ saveAgentSessionConfig: vi.fn() }))
vi.mock('@/mobile/camera-tool', () => ({
  registerCameraCaptureProvider: mocks.registerCameraCaptureProvider,
  unregisterCameraCaptureProvider: mocks.unregisterCameraCaptureProvider,
}))
vi.mock('@/mobile/character-profiles', () => ({
  listCharacterProfiles: () => [],
  selectSessionCharacter: vi.fn(),
}))
vi.mock('@/mobile/conversation-bridge', () => ({
  ensureAgentTaskForChat: vi.fn(),
  ensureChatSessionForTask: vi.fn(),
}))
vi.mock('@/mobile/interactive-conversation', () => ({ applyLive2DPromptToSession: vi.fn() }))
vi.mock('@/mobile/interactive-model-selection', () => ({
  resolveInteractiveModelSelection: () => undefined,
  updateInteractiveModelSelection: vi.fn(),
}))
vi.mock('@/mobile/live2d-models', () => ({
  completeLive2DOnboarding: vi.fn(),
  deleteLive2DModel: vi.fn(),
  getSelectedLive2DModelId: () => 'model-1',
  hasCompletedLive2DOnboarding: () => true,
  hideValidLive2DMarkers: (text: string) => text,
  importLive2DModel: vi.fn(),
  listLive2DModels: async () => [{ id: 'model-1', name: 'Model', source: 'model.json', actions: [], builtIn: true }],
  parseLive2DActionMarkers: () => [],
  setSelectedLive2DModelId: vi.fn(),
}))
vi.mock('@/mobile/live2d-performance', () => ({
  getLive2DRenderQuality: () => 'balanced',
  setLive2DRenderQuality: vi.fn(),
}))
vi.mock('@/mobile/speech-runtime', () => ({
  getSpeechRecognitionErrorMessage: () => 'speech_error',
  recognizeAndroidSpeech: mocks.recognizeAndroidSpeech,
  speakText: vi.fn(),
  stopAndroidSpeechRecognition: mocks.stopAndroidSpeechRecognition,
  stopSpeaking: mocks.stopSpeaking,
}))
vi.mock('@/stores/chatStore', () => ({
  useSession: () => ({ session: { id: 'session-1', name: 'Session', messages: [], settings: {} } }),
  updateSession: vi.fn(),
}))
vi.mock('@/stores/lastUsedModelStore', () => ({ lastUsedModelStore: { getState: () => ({}) } }))
vi.mock('@/stores/session/messages', () => ({ submitNewUserMessage: vi.fn() }))
vi.mock('@/stores/sessionActions', () => ({ createEmpty: mocks.createEmpty }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: (selector: (state: object) => unknown) => selector({}) }))
vi.mock('@/stores/taskSessionActions', () => ({ submitTaskMessage: vi.fn() }))
vi.mock('@/stores/taskSessionStore', () => ({
  updateTaskSession: vi.fn(),
  useTaskSessionRecord: () => ({ data: undefined }),
}))
vi.mock('./AndroidConversationHistory', () => ({ AndroidConversationHistory: () => null }))
vi.mock('./CharacterSelector', () => ({ CharacterSelector: () => null }))
vi.mock('./Live2DStage', () => ({
  Live2DStage: forwardRef<HTMLDivElement, { activity?: string }>(({ activity = 'active' }, ref) => (
    <div ref={ref} data-testid="live2d-stage" data-activity={activity} data-yachiyo-tab-swipe="block" />
  )),
}))

function dispatchPointerEvent(
  element: Element,
  type: string,
  values: { pointerId: number; button?: number; isPrimary?: boolean; clientX?: number; clientY?: number }
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(event, key, { value }))
  fireEvent(element, event)
}

describe('AndroidInteractive transient resources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stopAndroidSpeechRecognition.mockResolvedValue(undefined)
    mocks.stopSpeaking.mockResolvedValue(undefined)
    mocks.createEmpty.mockResolvedValue({ id: 'created-session' })
    mocks.recognizeAndroidSpeech.mockImplementation(() => new Promise<string>(() => undefined))
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: mocks.getUserMedia },
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('creates a missing session only while active and ignores a stale creation result', async () => {
    let resolveCreation: ((value: { id: string }) => void) | undefined
    mocks.createEmpty.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreation = resolve
        })
    )
    const onSessionChange = vi.fn()
    const { rerender } = render(
      <AndroidInteractive onSessionChange={onSessionChange} activity="preview" />
    )

    expect(mocks.createEmpty).not.toHaveBeenCalled()
    rerender(<AndroidInteractive onSessionChange={onSessionChange} activity="active" />)
    expect(mocks.createEmpty).toHaveBeenCalledOnce()
    rerender(<AndroidInteractive onSessionChange={onSessionChange} activity="inactive" />)

    resolveCreation?.({ id: 'stale-session' })
    await Promise.resolve()
    expect(onSessionChange).not.toHaveBeenCalled()
  })

  it('releases camera, recognition, and TTS only after the page becomes inactive', async () => {
    const track = { stop: vi.fn() }
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    mocks.getUserMedia.mockResolvedValue(stream)
    const { container, rerender } = render(
      <AndroidInteractive sessionId="session-1" onSessionChange={vi.fn()} activity="active" />
    )

    await screen.findByRole('button', { name: '摄像头' })
    fireEvent.click(screen.getByRole('button', { name: '摄像头' }))
    const video = await waitFor(() => {
      const element = container.querySelector('video')
      expect(element).not.toBeNull()
      expect(element?.srcObject).toBe(stream)
      return element as HTMLVideoElement
    })
    const microphone = screen.getByRole('button', { name: /按住说话/ })
    expect(microphone.getAttribute('data-yachiyo-tab-swipe')).toBe('block')
    dispatchPointerEvent(microphone, 'pointerdown', { pointerId: 7, button: 0, isPrimary: true })
    await waitFor(() => expect(microphone.getAttribute('data-recording')).toBe('true'))

    rerender(<AndroidInteractive sessionId="session-1" onSessionChange={vi.fn()} activity="preview" />)
    expect(track.stop).not.toHaveBeenCalled()
    expect(mocks.stopAndroidSpeechRecognition).not.toHaveBeenCalled()
    expect(screen.getByTestId('live2d-stage').getAttribute('data-activity')).toBe('preview')

    mocks.stopSpeaking.mockClear()
    rerender(<AndroidInteractive sessionId="session-1" onSessionChange={vi.fn()} activity="inactive" />)
    await waitFor(() => expect(track.stop).toHaveBeenCalledTimes(1))
    expect(video.srcObject).toBeNull()
    expect(mocks.stopAndroidSpeechRecognition).toHaveBeenCalledTimes(1)
    expect(mocks.stopSpeaking).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('live2d-stage').getAttribute('data-activity')).toBe('inactive')
  })

  it('uses element pointer capture for camera dragging and releases the stream on unmount', async () => {
    const track = { stop: vi.fn() }
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    mocks.getUserMedia.mockResolvedValue(stream)
    const { container, unmount } = render(
      <AndroidInteractive sessionId="session-1" onSessionChange={vi.fn()} />
    )

    fireEvent.click(await screen.findByRole('button', { name: '摄像头' }))
    const preview = await waitFor(() => {
      const element = container.querySelector('.yachiyo-camera-preview')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    expect(preview.getAttribute('data-yachiyo-tab-swipe')).toBe('block')
    dispatchPointerEvent(preview, 'pointerdown', {
      pointerId: 11,
      button: 0,
      isPrimary: true,
      clientX: 20,
      clientY: 30,
    })
    dispatchPointerEvent(preview, 'pointermove', { pointerId: 11, clientX: 44, clientY: 38 })
    expect(preview.style.transform).toBe('translate(24px, 8px)')
    dispatchPointerEvent(preview, 'pointercancel', { pointerId: 11 })
    dispatchPointerEvent(preview, 'pointermove', { pointerId: 11, clientX: 80, clientY: 80 })
    expect(preview.style.transform).toBe('translate(24px, 8px)')

    const video = container.querySelector('video') as HTMLVideoElement
    await waitFor(() => expect(video.srcObject).toBe(stream))
    unmount()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
  })

  it('stops transient resources when the document is hidden and does not resume them automatically', async () => {
    const track = { stop: vi.fn() }
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    mocks.getUserMedia.mockResolvedValue(stream)
    const { container } = render(
      <AndroidInteractive sessionId="session-1" onSessionChange={vi.fn()} activity="active" />
    )

    fireEvent.click(await screen.findByRole('button', { name: '摄像头' }))
    await waitFor(() => expect((container.querySelector('video') as HTMLVideoElement).srcObject).toBe(stream))
    const microphone = screen.getByRole('button', { name: /按住说话/ })
    dispatchPointerEvent(microphone, 'pointerdown', { pointerId: 21, button: 0, isPrimary: true })
    await waitFor(() => expect(microphone.getAttribute('data-recording')).toBe('true'))

    mocks.stopSpeaking.mockClear()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() => expect(track.stop).toHaveBeenCalledTimes(1))
    expect(mocks.stopAndroidSpeechRecognition).toHaveBeenCalledTimes(1)
    expect(mocks.stopSpeaking).toHaveBeenCalledTimes(1)
    expect(container.querySelector('video')).toBeNull()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(mocks.getUserMedia).toHaveBeenCalledTimes(1)
    expect(mocks.recognizeAndroidSpeech).toHaveBeenCalledTimes(1)
  })
})
