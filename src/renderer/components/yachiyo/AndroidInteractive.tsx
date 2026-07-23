import {
  ActionIcon,
  Button,
  FileButton,
  Loader,
  SegmentedControl,
  Select,
  Text,
  Textarea,
  UnstyledButton,
} from '@mantine/core'
import { createMessage, ModelProviderEnum } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import {
  IconCamera,
  IconChevronDown,
  IconHistory,
  IconKeyboard,
  IconMicrophone,
  IconPlayerStop,
  IconSettings,
  IconUpload,
  IconVolume,
  IconVolumeOff,
  IconX,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import ProviderImageIcon from '@/components/icons/ProviderImageIcon'
import ModelSelector from '@/components/ModelSelector'
import { useProviders } from '@/hooks/useProviders'
import { saveAgentSessionConfig } from '@/mobile/agent-session-config'
import { registerCameraCaptureProvider, unregisterCameraCaptureProvider } from '@/mobile/camera-tool'
import { ensureAgentTaskForChat, ensureChatSessionForTask } from '@/mobile/conversation-bridge'
import { applyLive2DPromptToSession } from '@/mobile/interactive-conversation'
import { resolveInteractiveModelSelection, updateInteractiveModelSelection } from '@/mobile/interactive-model-selection'
import {
  completeLive2DOnboarding,
  deleteLive2DModel,
  getSelectedLive2DModelId,
  hasCompletedLive2DOnboarding,
  hideValidLive2DMarkers,
  importLive2DModel,
  type Live2DModelDescriptor,
  listLive2DModels,
  parseLive2DActionMarkers,
  setSelectedLive2DModelId,
} from '@/mobile/live2d-models'
import { getLive2DRenderQuality, type Live2DRenderQuality, setLive2DRenderQuality } from '@/mobile/live2d-performance'
import {
  getSpeechRecognitionErrorMessage,
  recognizeAndroidSpeech,
  speakText,
  stopAndroidSpeechRecognition,
  stopSpeaking,
} from '@/mobile/speech-runtime'
import { useSession } from '@/stores/chatStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { submitNewUserMessage } from '@/stores/session/messages'
import { createEmpty } from '@/stores/sessionActions'
import { useSettingsStore } from '@/stores/settingsStore'
import { submitTaskMessage } from '@/stores/taskSessionActions'
import { useTaskSessionRecord } from '@/stores/taskSessionStore'
import { AndroidConversationHistory } from './AndroidConversationHistory'
import { CharacterSelector } from './CharacterSelector'
import { Live2DStage, type Live2DStageHandle } from './Live2DStage'

export function AndroidInteractive({
  sessionId,
  onSessionChange,
}: {
  sessionId?: string
  onSessionChange: (sessionId: string) => void
}) {
  const [models, setModels] = useState<Live2DModelDescriptor[]>([])
  const [selectedModelId, setSelectedModelId] = useState(getSelectedLive2DModelId)
  const [modelPickerOpen, setModelPickerOpen] = useState(!hasCompletedLive2DOnboarding())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [ttsSpeaking, setTtsSpeaking] = useState(false)
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [input, setInput] = useState('')
  const [agentMode, setAgentMode] = useState(false)
  const [taskId, setTaskId] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [notice, setNotice] = useState<string>()
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user')
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 0 })
  const [background, setBackground] = useState(() => localStorage.getItem('yachiyo.interactive.background') || '')
  const [renderQuality, setRenderQuality] = useState(getLive2DRenderQuality)
  const stageRef = useRef<Live2DStageHandle>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream>()
  const spokenRef = useRef<{ id?: string; length: number }>({ length: 0 })
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve())
  const speechGenerationRef = useRef(0)
  const voiceRecognitionAttemptRef = useRef(0)
  const interactiveRecognitionActiveRef = useRef(false)
  const handledMessageRef = useRef<{ id?: string; markers: Set<string> }>({ markers: new Set() })
  const { session } = useSession(sessionId || null)
  const { data: task } = useTaskSessionRecord(taskId || null)
  const { providers } = useProviders()
  const defaultChatModel = useSettingsStore((state) => state.defaultChatModel)

  useEffect(() => {
    void listLive2DModels().then(setModels)
  }, [])

  useEffect(() => {
    if (sessionId) return
    void createEmpty('chat').then((created) => onSessionChange(created.id))
  }, [onSessionChange, sessionId])

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) || models[0],
    [models, selectedModelId]
  )
  const conversationModel = useMemo(() => {
    const lastUsed = lastUsedModelStore.getState()
    return resolveInteractiveModelSelection({
      mode: agentMode ? 'agent' : 'chat',
      chatSettings: session?.settings,
      taskSettings: task?.settings,
      lastUsedChat: lastUsed.chat,
      lastUsedTask: lastUsed.task,
      defaultChat:
        defaultChatModel?.provider && defaultChatModel.model
          ? { provider: defaultChatModel.provider, modelId: defaultChatModel.model }
          : undefined,
    })
  }, [agentMode, defaultChatModel, session?.settings, task?.settings])
  const conversationModelName = useMemo(() => {
    if (!conversationModel) return '选择模型'
    const provider = providers.find((item) => item.id === conversationModel.provider)
    const model = (provider?.models || provider?.defaultSettings?.models)?.find(
      (item) => item.modelId === conversationModel.modelId
    )
    return model?.nickname || conversationModel.modelId
  }, [conversationModel, providers])
  const messages = agentMode ? task?.messages || [] : session?.messages || []
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const latestText = latestAssistant ? getMessageText(latestAssistant) : ''
  const bubbleText = selectedModel ? hideValidLive2DMarkers(latestText, selectedModel.actions).trim() : latestText
  const generating = Boolean(latestAssistant?.generating)

  useEffect(() => {
    if (!latestAssistant || muted) return
    if (spokenRef.current.id !== latestAssistant.id) {
      spokenRef.current = { id: latestAssistant.id, length: 0 }
      speechGenerationRef.current += 1
      setTtsSpeaking(false)
      speechQueueRef.current = stopSpeaking().catch(() => undefined)
    }
    const visible = selectedModel ? hideValidLive2DMarkers(latestText, selectedModel.actions) : latestText
    const pending = visible.slice(spokenRef.current.length)
    let consumed = 0
    const queueSpeech = (segment: string) => {
      const generation = speechGenerationRef.current
      speechQueueRef.current = speechQueueRef.current
        .then(async () => {
          if (generation !== speechGenerationRef.current || muted) return
          await speakText(segment, {
            onStart: () => {
              if (generation === speechGenerationRef.current) setTtsSpeaking(true)
            },
            onEnd: () => {
              if (generation === speechGenerationRef.current) setTtsSpeaking(false)
            },
          })
        })
        .catch(() => {
          if (generation === speechGenerationRef.current) setTtsSpeaking(false)
        })
    }
    for (const match of pending.matchAll(/[^.!?\n\u3002\uff01\uff1f]+[.!?\n\u3002\uff01\uff1f]+/g)) {
      const segment = match[0].trim()
      consumed = (match.index || 0) + match[0].length
      if (segment) queueSpeech(segment)
    }
    spokenRef.current.length += consumed
    if (!generating && visible.length > spokenRef.current.length) {
      const tail = visible.slice(spokenRef.current.length).trim()
      spokenRef.current.length = visible.length
      if (tail) queueSpeech(tail)
    }
  }, [generating, latestAssistant, latestText, muted, selectedModel])

  useEffect(() => {
    if (!muted) return
    speechGenerationRef.current += 1
    speechQueueRef.current = Promise.resolve()
    setTtsSpeaking(false)
    void stopSpeaking()
  }, [muted])

  useEffect(() => {
    if (!bubbleText) {
      setBubbleVisible(false)
      return
    }
    setBubbleVisible(true)
    const timeout = window.setTimeout(() => setBubbleVisible(false), 5000)
    return () => window.clearTimeout(timeout)
  }, [bubbleText])

  useEffect(() => {
    if (!voiceTranscript || recording) return
    const timeout = window.setTimeout(() => setVoiceTranscript(''), 3000)
    return () => window.clearTimeout(timeout)
  }, [recording, voiceTranscript])

  useEffect(
    () => () => {
      speechGenerationRef.current += 1
      void stopSpeaking()
      if (interactiveRecognitionActiveRef.current) void stopAndroidSpeechRecognition()
    },
    []
  )

  useEffect(() => {
    if (!cameraEnabled) {
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = undefined
      return
    }
    let disposed = false
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: cameraFacing }, width: { ideal: 1280 } }, audio: false })
      .then((stream) => {
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
        cameraStreamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
      })
      .catch(() => {
        setCameraEnabled(false)
        setNotice('无法打开摄像头，请授予相机权限')
      })
    return () => {
      disposed = true
    }
  }, [cameraEnabled, cameraFacing])

  const captureCurrentCamera = useCallback(() => {
    const video = videoRef.current
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      throw new Error('camera_frame_not_ready')
    }
    const scale = Math.min(1, 1280 / video.videoWidth)
    const width = Math.max(1, Math.round(video.videoWidth * scale))
    const height = Math.max(1, Math.round(video.videoHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('camera_canvas_unavailable')
    context.drawImage(video, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
    return Promise.resolve({
      data: dataUrl.slice(dataUrl.indexOf(',') + 1),
      mediaType: 'image/jpeg' as const,
      width,
      height,
    })
  }, [])

  useEffect(() => {
    if (!cameraEnabled) return
    const ids = [sessionId, taskId].filter((id): id is string => Boolean(id))
    ids.forEach((id) => registerCameraCaptureProvider(id, captureCurrentCamera))
    return () => ids.forEach((id) => unregisterCameraCaptureProvider(id, captureCurrentCamera))
  }, [cameraEnabled, captureCurrentCamera, sessionId, taskId])

  useEffect(() => {
    if (!selectedModel || !latestAssistant) return
    if (handledMessageRef.current.id !== latestAssistant.id) {
      handledMessageRef.current = { id: latestAssistant.id, markers: new Set() }
    }
    const markerEvents = parseLive2DActionMarkers(latestText, selectedModel.actions)
    markerEvents.forEach((event) => {
      const markerId = `${event.index}:${event.marker}`
      if (handledMessageRef.current.markers.has(markerId)) return
      handledMessageRef.current.markers.add(markerId)
      void stageRef.current?.perform(event.action)
    })
  }, [latestAssistant, latestText, selectedModel])

  const chooseModel = (model: Live2DModelDescriptor) => {
    setSelectedModelId(model.id)
    setSelectedLive2DModelId(model.id)
    completeLive2DOnboarding()
    setModelPickerOpen(false)
  }

  const importModel = async (file: File | null) => {
    if (!file) return
    setNotice('正在导入 Live2D 模型…')
    try {
      const imported = await importLive2DModel(file)
      setModels(await listLive2DModels())
      chooseModel(imported)
      setNotice('模型已导入')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '模型导入失败')
    }
  }

  const toggleAgent = async (value: string) => {
    if (!sessionId) return
    if (value === 'agent') {
      const agentTask = await ensureAgentTaskForChat(sessionId)
      saveAgentSessionConfig(agentTask.id, { enabled: true, configured: true })
      setTaskId(agentTask.id)
      setAgentMode(true)
    } else {
      if (taskId) await ensureChatSessionForTask(taskId)
      setAgentMode(false)
    }
  }

  const selectConversationModel = async (provider: string, modelId: string) => {
    try {
      await updateInteractiveModelSelection({
        mode: agentMode ? 'agent' : 'chat',
        sessionId,
        taskId,
        chatSettings: session?.settings,
        taskSettings: task?.settings,
        provider,
        modelId,
      })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '模型切换失败')
    }
  }

  const submit = async (value = input) => {
    const text = value.trim()
    if (!text || !sessionId || !selectedModel || submitting) return
    setSubmitting(true)
    setInput('')
    try {
      await applyLive2DPromptToSession(sessionId, selectedModel.actions)
      if (agentMode) {
        const agentTask = taskId ? task : await ensureAgentTaskForChat(sessionId)
        const targetTaskId = agentTask?.id || taskId
        if (!targetTaskId) throw new Error('Agent 会话初始化失败')
        setTaskId(targetTaskId)
        await submitTaskMessage(targetTaskId, text)
      } else {
        await submitNewUserMessage(sessionId, {
          newUserMsg: createMessage('user', text),
          needGenerating: true,
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!selectedModel) {
    return (
      <div className="yachiyo-interactive-loading">
        <Loader color="pink" />
      </div>
    )
  }

  return (
    <main className="yachiyo-interactive-page">
      <header className="yachiyo-interactive-header">
        <div className="yachiyo-interactive-header-main">
          <ActionIcon variant="subtle" color="gray" aria-label="会话记录" onClick={() => setHistoryOpen(true)}>
            <IconHistory size={21} />
          </ActionIcon>
          <button type="button" className="yachiyo-interactive-title" onClick={() => setModelPickerOpen(true)}>
            <strong>{selectedModel.name}</strong>
            <span>{session?.name || '交互式对话'}</span>
          </button>
          <ModelSelector
            onSelect={(provider, modelId) => void selectConversationModel(String(provider), modelId)}
            selectedProviderId={conversationModel?.provider}
            selectedModelId={conversationModel?.modelId}
            modelFilter={(model, providerId) =>
              !agentMode ||
              providerId === ModelProviderEnum.Yachiyo ||
              Boolean(model.capabilities?.includes('tool_use'))
            }
            position="bottom-end"
            transitionProps={{ transition: 'fade-down', duration: 180 }}
          >
            <UnstyledButton
              className="yachiyo-interactive-llm-selector"
              aria-label={`切换模型：${conversationModelName}`}
              title={conversationModelName}
            >
              {conversationModel && <ProviderImageIcon size={18} provider={conversationModel.provider} />}
              <span>{conversationModelName}</span>
              <IconChevronDown size={14} />
            </UnstyledButton>
          </ModelSelector>
        </div>
        <div className="yachiyo-interactive-header-actions">
          <CharacterSelector sessionId={sessionId} />
          <SegmentedControl
            className="yachiyo-interactive-mode-control"
            size="xs"
            value={agentMode ? 'agent' : 'chat'}
            data={[
              { label: '聊天', value: 'chat' },
              { label: 'Agent', value: 'agent' },
            ]}
            onChange={(value) => void toggleAgent(value)}
          />
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={muted ? '取消静音' : '静音'}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <IconVolumeOff size={21} /> : <IconVolume size={21} />}
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color={cameraEnabled ? 'pink' : 'gray'}
            aria-label="摄像头"
            onClick={() => setCameraEnabled(!cameraEnabled)}
          >
            <IconCamera size={21} />
          </ActionIcon>
          <ActionIcon variant="subtle" color="gray" aria-label="交互设置" onClick={() => setModelPickerOpen(true)}>
            <IconSettings size={21} />
          </ActionIcon>
        </div>
      </header>

      <section className="yachiyo-interactive-scene">
        <div
          className="yachiyo-interactive-backdrop"
          style={background ? { backgroundImage: `url(${background})` } : undefined}
        />
        <Live2DStage
          ref={stageRef}
          model={selectedModel}
          speaking={ttsSpeaking}
          muted={muted}
          quality={renderQuality}
        />
        {cameraEnabled && (
          <div
            className="yachiyo-camera-preview"
            style={{ transform: `translate(${cameraPosition.x}px, ${cameraPosition.y}px)` }}
            onPointerDown={(event) => {
              const start = { clientX: event.clientX, clientY: event.clientY, position: cameraPosition }
              event.currentTarget.setPointerCapture(event.pointerId)
              const move = (moveEvent: PointerEvent) =>
                setCameraPosition({
                  x: start.position.x + moveEvent.clientX - start.clientX,
                  y: start.position.y + moveEvent.clientY - start.clientY,
                })
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
            onClick={() => setCameraFacing(cameraFacing === 'user' ? 'environment' : 'user')}
          >
            <video ref={videoRef} muted playsInline />
          </div>
        )}
        {bubbleText && bubbleVisible && (
          <div className="yachiyo-live-bubble" aria-live="polite">
            <div>{bubbleText}</div>
          </div>
        )}
        {voiceTranscript && (
          <div className="yachiyo-live-transcript" aria-live="polite">
            {voiceTranscript}
          </div>
        )}
        {notice && (
          <button type="button" className="yachiyo-interactive-notice" onClick={() => setNotice(undefined)}>
            {notice}
            <IconX size={14} />
          </button>
        )}
      </section>

      <footer className="yachiyo-interactive-controls">
        <button
          type="button"
          className="yachiyo-interactive-round-button yachiyo-interactive-mic"
          data-recording={recording ? 'true' : 'false'}
          onPointerDown={() => {
            if (interactiveRecognitionActiveRef.current) return
            const attempt = ++voiceRecognitionAttemptRef.current
            interactiveRecognitionActiveRef.current = true
            setRecording(true)
            setVoiceTranscript('')
            void recognizeAndroidSpeech({
              onPartial: (text) => {
                if (voiceRecognitionAttemptRef.current === attempt) setVoiceTranscript(text)
              },
            })
              .then((text) => {
                if (voiceRecognitionAttemptRef.current !== attempt || !text) return
                setVoiceTranscript(text)
                void submit(text)
              })
              .catch((error) => setNotice(getSpeechRecognitionErrorMessage(error)))
              .finally(() => {
                if (voiceRecognitionAttemptRef.current === attempt) {
                  interactiveRecognitionActiveRef.current = false
                  setRecording(false)
                }
              })
          }}
          onPointerUp={() => {
            setRecording(false)
            void stopAndroidSpeechRecognition()
          }}
          onPointerCancel={() => {
            setRecording(false)
            void stopAndroidSpeechRecognition()
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {recording ? <IconPlayerStop size={24} /> : <IconMicrophone size={24} />}
          <span>{recording ? '松开发送' : '按住说话'}</span>
        </button>
        <div className="yachiyo-interactive-keyboard" data-open={keyboardOpen ? 'true' : 'false'}>
          {keyboardOpen && (
            <Textarea
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              placeholder="输入消息"
              autosize
              minRows={1}
              maxRows={4}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
          )}
          <button
            type="button"
            className="yachiyo-interactive-round-button"
            aria-label={keyboardOpen ? '发送消息' : '打开键盘'}
            onClick={() => (keyboardOpen && input.trim() ? void submit() : setKeyboardOpen(!keyboardOpen))}
          >
            <IconKeyboard size={24} />
            {keyboardOpen && <span>{input.trim() ? '发送' : '收起'}</span>}
          </button>
        </div>
      </footer>

      <AndroidConversationHistory
        opened={historyOpen}
        mode={agentMode ? 'agent' : 'chat'}
        currentId={sessionId}
        onClose={() => setHistoryOpen(false)}
        onSelectSession={onSessionChange}
      />

      <AdaptiveModal opened={modelPickerOpen} onClose={() => setModelPickerOpen(false)} title="Live2D 模型" centered>
        <div className="yachiyo-live2d-picker">
          <Text size="sm" c="dimmed">
            选择内置模型，或导入包含 .model3.json 的 ZIP 模型包。
          </Text>
          <Select
            label="显示质量"
            value={renderQuality}
            allowDeselect={false}
            data={[
              { value: 'performance', label: '省电（1x）' },
              { value: 'balanced', label: '均衡（最高 1.75x）' },
              { value: 'high', label: '高清（最高 2.5x）' },
            ]}
            onChange={(value) => {
              if (!value) return
              const quality = value as Live2DRenderQuality
              setRenderQuality(quality)
              setLive2DRenderQuality(quality)
            }}
          />
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              className="yachiyo-live2d-model-row"
              data-selected={model.id === selectedModel.id ? 'true' : 'false'}
              onClick={() => chooseModel(model)}
            >
              {model.avatar ? <img src={model.avatar} alt="" /> : <span className="yachiyo-live2d-model-placeholder" />}
              <span>
                <strong>{model.name}</strong>
                <small>{model.actions.length} 个表情/动作</small>
              </span>
              {!model.builtIn && (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`删除 ${model.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void deleteLive2DModel(model.id).then(async () => setModels(await listLive2DModels()))
                  }}
                >
                  <IconX size={18} />
                </ActionIcon>
              )}
            </button>
          ))}
          <FileButton accept="application/zip,.zip" onChange={importModel}>
            {(props) => (
              <Button {...props} leftSection={<IconUpload size={18} />}>
                导入 Live2D ZIP
              </Button>
            )}
          </FileButton>
          <FileButton
            accept="image/png,image/jpeg,image/webp"
            onChange={(file) => {
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => {
                const value = String(reader.result || '')
                setBackground(value)
                localStorage.setItem('yachiyo.interactive.background', value)
              }
              reader.readAsDataURL(file)
            }}
          >
            {(props) => (
              <Button {...props} variant="light">
                更换交互背景
              </Button>
            )}
          </FileButton>
        </div>
      </AdaptiveModal>
    </main>
  )
}
