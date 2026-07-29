import {
  ActionIcon,
  Button,
  FileButton,
  Loader,
  Menu,
  SegmentedControl,
  Select,
  Text,
  Textarea,
  UnstyledButton,
} from '@mantine/core'
import { createMessage, ModelProviderEnum, type ReasoningStrength } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { getSessionReasoningStrength, REASONING_STRENGTHS } from '@shared/utils/reasoning-strength'
import {
  IconCamera,
  IconBrain,
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconCpu,
  IconHistory,
  IconMicrophone,
  IconPlayerStop,
  IconSettings,
  IconUpload,
  IconUserCircle,
  IconVolume,
  IconVolumeOff,
  IconX,
} from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ReasoningStrengthControl } from '@/components/ReasoningStrengthControl'
import ProviderImageIcon from '@/components/icons/ProviderImageIcon'
import ModelSelector from '@/components/ModelSelector'
import { useProviders } from '@/hooks/useProviders'
import { saveAgentSessionConfig } from '@/mobile/agent-session-config'
import { registerCameraCaptureProvider, unregisterCameraCaptureProvider } from '@/mobile/camera-tool'
import { listCharacterProfiles, selectSessionCharacter } from '@/mobile/character-profiles'
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
import { updateSession } from '@/stores/chatStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { submitNewUserMessage } from '@/stores/session/messages'
import { createEmpty } from '@/stores/sessionActions'
import { useSettingsStore } from '@/stores/settingsStore'
import { submitTaskMessage } from '@/stores/taskSessionActions'
import { flowGlassHaptics } from '@/utils/mobile-haptics'
import { updateTaskSession, useTaskSessionRecord } from '@/stores/taskSessionStore'
import { AndroidConversationHistory } from './AndroidConversationHistory'
import { AdaptiveActionCluster, type AdaptiveActionDescriptor } from './AdaptiveActionCluster'
import { AndroidInteractiveChrome } from './AndroidSharedChrome'
import { CharacterSelector } from './CharacterSelector'
import { Live2DStage, type Live2DStageHandle } from './Live2DStage'
import { useAndroidRetainedState } from './android-retained-state'
import type { AndroidTabPageActivity } from './android-tab-page-activity'

export function AndroidInteractive({
  sessionId,
  onSessionChange,
  activity = 'active',
}: {
  sessionId?: string
  onSessionChange: (sessionId: string) => void
  activity?: AndroidTabPageActivity
}) {
  const { t } = useTranslation()
  const retainedSessionKey = sessionId || 'new'
  const [models, setModels] = useState<Live2DModelDescriptor[]>([])
  const [selectedModelId, setSelectedModelId] = useState(getSelectedLive2DModelId)
  const [modelPickerOpen, setModelPickerOpen] = useState(() => activity === 'active' && !hasCompletedLive2DOnboarding())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [ttsSpeaking, setTtsSpeaking] = useState(false)
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [input, setInput] = useAndroidRetainedState(`interactive:${retainedSessionKey}:composer-draft`, '')
  const [agentMode, setAgentMode] = useAndroidRetainedState(
    `interactive:${retainedSessionKey}:conversation-mode`,
    false
  )
  const [taskId, setTaskId] = useAndroidRetainedState<string | undefined>(
    `interactive:${retainedSessionKey}:agent-task`,
    undefined
  )
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
  const cameraDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    moved: boolean
  }>()
  const suppressCameraClickRef = useRef(false)
  const activityRef = useRef(activity)
  const sessionIdRef = useRef(sessionId)
  const onSessionChangeRef = useRef(onSessionChange)
  const sessionCreationGenerationRef = useRef(0)
  const sessionCreationRef = useRef<Promise<{ id: string }>>()
  const onboardingPromptedRef = useRef(activity === 'active')
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

  activityRef.current = activity
  sessionIdRef.current = sessionId
  onSessionChangeRef.current = onSessionChange

  useEffect(() => {
    if (activity !== 'active' || onboardingPromptedRef.current) return
    onboardingPromptedRef.current = true
    if (!hasCompletedLive2DOnboarding()) setModelPickerOpen(true)
  }, [activity])

  useEffect(() => {
    void listLive2DModels().then(setModels)
  }, [])

  useEffect(() => {
    const generation = ++sessionCreationGenerationRef.current
    if (activity !== 'active' || sessionId) return

    const creation = sessionCreationRef.current ?? createEmpty('chat')
    sessionCreationRef.current = creation
    void creation
      .then((created) => {
        if (
          generation !== sessionCreationGenerationRef.current ||
          activityRef.current !== 'active' ||
          sessionIdRef.current
        ) {
          return
        }
        onSessionChangeRef.current(created.id)
      })
      .catch(() => undefined)
      .finally(() => {
        if (sessionCreationRef.current === creation) sessionCreationRef.current = undefined
      })

    return () => {
      if (sessionCreationGenerationRef.current === generation) sessionCreationGenerationRef.current += 1
    }
  }, [activity, sessionId])

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
    if (!conversationModel) return t('选择模型')
    const provider = providers.find((item) => item.id === conversationModel.provider)
    const model = (provider?.models || provider?.defaultSettings?.models)?.find(
      (item) => item.modelId === conversationModel.modelId
    )
    return model?.nickname || conversationModel.modelId
  }, [conversationModel, providers, t])
  const messages = agentMode ? task?.messages || [] : session?.messages || []
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const latestText = latestAssistant ? getMessageText(latestAssistant) : ''
  const bubbleText = selectedModel ? hideValidLive2DMarkers(latestText, selectedModel.actions).trim() : latestText
  const generating = Boolean(latestAssistant?.generating)
  const cameraActive = cameraEnabled && activity !== 'inactive'

  useEffect(() => {
    if (!latestAssistant || muted || activity !== 'active') return
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
          if (generation !== speechGenerationRef.current || muted || activityRef.current !== 'active') return
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
  }, [activity, generating, latestAssistant, latestText, muted, selectedModel])

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
      voiceRecognitionAttemptRef.current += 1
      if (interactiveRecognitionActiveRef.current) {
        interactiveRecognitionActiveRef.current = false
        void stopAndroidSpeechRecognition()
      }
    },
    []
  )

  const stopTransientResources = useCallback(() => {
    speechGenerationRef.current += 1
    speechQueueRef.current = Promise.resolve()
    setTtsSpeaking(false)
    void stopSpeaking()

    voiceRecognitionAttemptRef.current += 1
    if (interactiveRecognitionActiveRef.current) {
      interactiveRecognitionActiveRef.current = false
      setRecording(false)
      void stopAndroidSpeechRecognition()
    }
    setCameraEnabled(false)
  }, [])

  useEffect(() => {
    if (activity !== 'inactive') return
    stopTransientResources()
  }, [activity, stopTransientResources])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stopTransientResources()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (document.visibilityState === 'hidden') onVisibilityChange()
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [stopTransientResources])

  useEffect(() => {
    const video = videoRef.current
    let disposed = false
    let ownedStream: MediaStream | undefined

    const releaseStream = (stream: MediaStream | undefined) => {
      stream?.getTracks().forEach((track) => track.stop())
      if (cameraStreamRef.current === stream) cameraStreamRef.current = undefined
      if (video && (!stream || video.srcObject === stream)) video.srcObject = null
    }

    if (!cameraActive) {
      releaseStream(cameraStreamRef.current)
      return
    }

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: cameraFacing }, width: { ideal: 1280 } }, audio: false })
      .then((stream) => {
        ownedStream = stream
        if (disposed) {
          releaseStream(stream)
          return
        }
        releaseStream(cameraStreamRef.current)
        cameraStreamRef.current = stream
        if (video) {
          video.srcObject = stream
          void video.play().catch(() => undefined)
        }
      })
      .catch(() => {
        if (disposed) return
        setCameraEnabled(false)
        setNotice(String(t('无法打开摄像头，请授予相机权限')))
      })
    return () => {
      disposed = true
      releaseStream(ownedStream)
    }
  }, [cameraActive, cameraFacing, t])

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
    if (!cameraActive) return
    const ids = [sessionId, taskId].filter((id): id is string => Boolean(id))
    ids.forEach((id) => registerCameraCaptureProvider(id, captureCurrentCamera))
    return () => ids.forEach((id) => unregisterCameraCaptureProvider(id, captureCurrentCamera))
  }, [cameraActive, captureCurrentCamera, sessionId, taskId])

  useEffect(() => {
    if (activity !== 'active' || !selectedModel || !latestAssistant) return
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
  }, [activity, latestAssistant, latestText, selectedModel])

  const chooseModel = (model: Live2DModelDescriptor) => {
    setSelectedModelId(model.id)
    setSelectedLive2DModelId(model.id)
    completeLive2DOnboarding()
    setModelPickerOpen(false)
  }

  const importModel = async (file: File | null) => {
    if (!file) return
    setNotice(String(t('正在导入 Live2D 模型…')))
    try {
      const imported = await importLive2DModel(file)
      setModels(await listLive2DModels())
      chooseModel(imported)
      setNotice(String(t('模型已导入')))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(t('模型导入失败')))
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
      const selectedInfo = providers
        .find((item) => item.id === provider)
        ?.models?.find((item) => item.modelId === modelId)
      if (agentMode && !selectedInfo?.capabilities?.includes('tool_use')) {
        setNotice(String(t('该模型仅支持聊天，当前不会调用 Agent 工具。')))
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(t('模型切换失败')))
    }
  }

  const updateReasoningStrength = async (reasoningStrength: ReasoningStrength) => {
    if (agentMode && taskId) {
      await updateTaskSession(taskId, { settings: { ...(task?.settings || {}), reasoningStrength } })
    } else if (sessionId) {
      await updateSession(sessionId, { settings: { ...(session?.settings || {}), reasoningStrength } })
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
        if (!targetTaskId) throw new Error(String(t('Agent 会话初始化失败')))
        setTaskId(targetTaskId)
        await submitTaskMessage(targetTaskId, text)
      } else {
        await submitNewUserMessage(sessionId, {
          newUserMsg: createMessage('user', text),
          needGenerating: true,
        })
      }
      void flowGlassHaptics.lightImpact()
    } finally {
      setSubmitting(false)
    }
  }

  const interactiveHeaderActions: AdaptiveActionDescriptor[] = [
    {
      id: 'character',
      label: String(t('切换人格')),
      icon: IconUserCircle,
      priority: 20,
      group: 'identity',
      collapseStrategy: 'icon-then-overflow',
      renderControl: ({ presentation }) => (
        <CharacterSelector sessionId={sessionId} compact={presentation === 'icon'} />
      ),
      menuAction: {
        render: ({ closeMenu }) => (
          <>
            <Menu.Label>{t('切换人格')}</Menu.Label>
            {listCharacterProfiles().map((profile) => (
              <Menu.Item
                key={profile.id}
                leftSection={<img src={profile.avatar} alt="" className="yachiyo-character-menu-avatar" />}
                onClick={() => {
                  closeMenu()
                  if (sessionId) void selectSessionCharacter(sessionId, profile)
                }}
              >
                {profile.name}
              </Menu.Item>
            ))}
          </>
        ),
      },
    },
    {
      id: 'reasoning',
      label: String(t('推理强度')),
      icon: IconBrain,
      priority: 30,
      group: 'identity',
      collapseStrategy: 'icon-then-overflow',
      renderControl: () => (
        <ReasoningStrengthControl
          settings={agentMode ? task?.settings : session?.settings}
          onChange={(value) => void updateReasoningStrength(value)}
          compact
        />
      ),
      menuAction: {
        render: ({ closeMenu }) => {
          const selectedStrength =
            getSessionReasoningStrength(agentMode ? task?.settings : session?.settings) || 'medium'
          const labels: Record<ReasoningStrength, string> = {
            off: String(t('不思考')),
            minimal: String(t('极低')),
            low: String(t('低')),
            medium: String(t('中')),
            high: String(t('高')),
            max: 'MAX',
          }
          return (
            <>
              <Menu.Label>{t('推理强度')}</Menu.Label>
              {REASONING_STRENGTHS.map((strength) => (
                <Menu.Item
                  key={strength}
                  rightSection={selectedStrength === strength ? <IconCheck size={15} /> : undefined}
                  onClick={() => {
                    closeMenu()
                    void updateReasoningStrength(strength)
                  }}
                >
                  {labels[strength]}
                </Menu.Item>
              ))}
            </>
          )
        },
      },
    },
    {
      id: 'mode',
      label: String(t('对话模式')),
      priority: 100,
      group: 'mode',
      collapseStrategy: 'keep',
      renderControl: () => (
        <SegmentedControl
          className="yachiyo-interactive-mode-control"
          size="xs"
          value={agentMode ? 'agent' : 'chat'}
          data={[
            { label: t('聊天'), value: 'chat' },
            { label: t('Agent'), value: 'agent' },
          ]}
          onChange={(value) => void toggleAgent(value)}
        />
      ),
    },
    {
      id: 'mute',
      label: String(muted ? t('取消静音') : t('静音')),
      priority: 90,
      group: 'media',
      collapseStrategy: 'keep',
      renderControl: () => (
        <ActionIcon
          variant="subtle"
          color="gray"
          size={44}
          aria-label={muted ? t('取消静音') : t('静音')}
          data-active={muted ? 'true' : 'false'}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <IconVolumeOff size={21} /> : <IconVolume size={21} />}
        </ActionIcon>
      ),
    },
    {
      id: 'camera',
      label: String(t('摄像头')),
      priority: 80,
      group: 'media',
      collapseStrategy: 'keep',
      renderControl: () => (
        <ActionIcon
          variant="subtle"
          color={cameraEnabled ? 'chatbox-brand' : 'gray'}
          size={44}
          aria-label={t('摄像头')}
          data-active={cameraEnabled ? 'true' : 'false'}
          data-yachiyo-tab-swipe="block"
          onClick={() => setCameraEnabled(!cameraEnabled)}
        >
          <IconCamera size={21} />
        </ActionIcon>
      ),
    },
    {
      id: 'settings',
      label: String(t('交互设置')),
      icon: IconSettings,
      priority: 10,
      group: 'secondary',
      collapseStrategy: 'overflow',
      renderControl: () => (
        <ActionIcon
          variant="subtle"
          color="gray"
          size={44}
          aria-label={t('交互设置')}
          onClick={() => setModelPickerOpen(true)}
        >
          <IconSettings size={21} />
        </ActionIcon>
      ),
      menuAction: { onSelect: () => setModelPickerOpen(true) },
    },
  ]

  const interactiveChrome = (
    <AndroidInteractiveChrome>
      <div className="yachiyo-interactive-header-main">
        <ActionIcon
          size={44}
          variant="subtle"
          color="gray"
          aria-label={t('会话记录')}
          onClick={() => setHistoryOpen(true)}
        >
          <IconHistory size={21} />
        </ActionIcon>
        <button type="button" className="yachiyo-interactive-title" onClick={() => setModelPickerOpen(true)}>
          <strong>{selectedModel?.name || t('交互式对话')}</strong>
          <span>{session?.name || t('交互式对话')}</span>
        </button>
        <ModelSelector
          onSelect={(provider, modelId) => void selectConversationModel(String(provider), modelId)}
          selectedProviderId={conversationModel?.provider}
          selectedModelId={conversationModel?.modelId}
          modelFilter={(model, providerId) =>
            !agentMode ||
            providerId === ModelProviderEnum.Yachiyo ||
            providerId === ModelProviderEnum.Local ||
            Boolean(model.capabilities?.includes('tool_use'))
          }
          position="bottom-end"
          transitionProps={{ transition: 'fade-down', duration: 180 }}
        >
          <UnstyledButton
            className="yachiyo-interactive-llm-selector"
            aria-label={t('切换模型：{{model}}', { model: conversationModelName })}
            title={conversationModelName}
          >
            {conversationModel?.provider === ModelProviderEnum.Local ? (
              <IconCpu size={18} aria-hidden="true" />
            ) : (
              conversationModel && <ProviderImageIcon size={18} provider={conversationModel.provider} />
            )}
            <span>{conversationModelName}</span>
            <IconChevronDown size={14} />
          </UnstyledButton>
        </ModelSelector>
      </div>
      <AdaptiveActionCluster
        className="yachiyo-interactive-header-actions"
        ariaLabel={String(t('交互操作'))}
        actions={interactiveHeaderActions}
      />
    </AndroidInteractiveChrome>
  )

  if (!selectedModel) {
    return (
      <main className="yachiyo-interactive-page" data-activity={activity}>
        {interactiveChrome}
        <div className="yachiyo-interactive-loading">
          <Loader color="chatbox-brand" />
        </div>
      </main>
    )
  }

  return (
    <main className="yachiyo-interactive-page" data-activity={activity}>
      {interactiveChrome}

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
          activity={activity}
        />
        {cameraActive && (
          <div
            className="yachiyo-camera-preview"
            data-yachiyo-tab-swipe="block"
            style={{ transform: `translate(${cameraPosition.x}px, ${cameraPosition.y}px)` }}
            onPointerDown={(event) => {
              if (activityRef.current !== 'active' || event.isPrimary === false || event.button !== 0) return
              suppressCameraClickRef.current = false
              cameraDragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                originX: cameraPosition.x,
                originY: cameraPosition.y,
                moved: false,
              }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const drag = cameraDragRef.current
              if (!drag || drag.pointerId !== event.pointerId) return
              const dx = event.clientX - drag.startX
              const dy = event.clientY - drag.startY
              if (!drag.moved && Math.hypot(dx, dy) >= 4) drag.moved = true
              setCameraPosition({ x: drag.originX + dx, y: drag.originY + dy })
            }}
            onPointerUp={(event) => {
              const drag = cameraDragRef.current
              if (!drag || drag.pointerId !== event.pointerId) return
              suppressCameraClickRef.current = drag.moved
              cameraDragRef.current = undefined
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onPointerCancel={(event) => {
              const drag = cameraDragRef.current
              if (!drag || drag.pointerId !== event.pointerId) return
              suppressCameraClickRef.current = drag.moved
              cameraDragRef.current = undefined
            }}
            onLostPointerCapture={(event) => {
              const drag = cameraDragRef.current
              if (!drag || drag.pointerId !== event.pointerId) return
              suppressCameraClickRef.current = drag.moved
              cameraDragRef.current = undefined
            }}
            onClick={() => {
              if (suppressCameraClickRef.current) {
                suppressCameraClickRef.current = false
                return
              }
              setCameraFacing(cameraFacing === 'user' ? 'environment' : 'user')
            }}
          >
            <video ref={videoRef} muted playsInline draggable={false} />
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
          aria-label={String(t(recording ? '松开发送' : '按住说话'))}
          data-yachiyo-tab-swipe="block"
          data-recording={recording ? 'true' : 'false'}
          onPointerDown={(event) => {
            if (activityRef.current !== 'active' || interactiveRecognitionActiveRef.current) return
            event.currentTarget.setPointerCapture(event.pointerId)
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
              .catch((error) => {
                if (voiceRecognitionAttemptRef.current !== attempt) return
                const message = getSpeechRecognitionErrorMessage(error)
                // The speech runtime formats HTTP failures before this UI can translate them.
                const httpFailure = message.match(/^语音识别 API 请求失败（HTTP (.+)）。$/)
                setNotice(
                  String(
                    httpFailure
                      ? t('语音识别 API 请求失败（HTTP {{status}}）。', { status: httpFailure[1] })
                      : t(message)
                  )
                )
              })
              .finally(() => {
                if (voiceRecognitionAttemptRef.current === attempt) {
                  interactiveRecognitionActiveRef.current = false
                  setRecording(false)
                }
              })
          }}
          onPointerUp={(event) => {
            setRecording(false)
            void stopAndroidSpeechRecognition()
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
          onPointerCancel={() => {
            setRecording(false)
            void stopAndroidSpeechRecognition()
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {recording ? <IconPlayerStop size={24} /> : <IconMicrophone size={24} />}
        </button>
        <Textarea
          className="yachiyo-interactive-keyboard-input"
          data-yachiyo-tab-swipe="block"
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder={String(t('输入消息'))}
          autosize
          minRows={1}
          maxRows={4}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <button
          type="button"
          className="yachiyo-interactive-round-button yachiyo-interactive-send"
          aria-label={String(t('发送消息'))}
          disabled={!input.trim() || submitting}
          onClick={() => void submit()}
        >
          <IconArrowUp size={24} />
        </button>
      </footer>

      <AndroidConversationHistory
        opened={historyOpen}
        mode={agentMode ? 'agent' : 'chat'}
        currentId={sessionId}
        onClose={() => setHistoryOpen(false)}
        onSelectSession={onSessionChange}
      />

      <AdaptiveModal
        opened={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        title={t('Live2D 模型')}
        className="yachiyo-live2d-picker-modal"
        centered
      >
        <div className="yachiyo-live2d-picker">
          <Text size="sm" c="dimmed" className="yachiyo-live2d-picker-description">
            {t('选择内置模型，或导入包含 .model3.json 的 ZIP 模型包。')}
          </Text>
          <Select
            className="yachiyo-live2d-quality-control"
            label={t('显示质量')}
            value={renderQuality}
            allowDeselect={false}
            data={[
              { value: 'performance', label: t('省电（1x）') },
              { value: 'balanced', label: t('均衡（最高 1.75x）') },
              { value: 'high', label: t('高清（最高 2.5x）') },
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
                <small>{t('{{actionCount}} 个表情/动作', { actionCount: model.actions.length })}</small>
              </span>
              {!model.builtIn && (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={t('删除 {{name}}', { name: model.name })}
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
              <Button
                {...props}
                className="yachiyo-live2d-import-button"
                leftSection={<IconUpload size={18} />}
              >
                {t('导入 Live2D ZIP')}
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
              <Button {...props} className="yachiyo-live2d-background-button" variant="light">
                {t('更换交互背景')}
              </Button>
            )}
          </FileButton>
        </div>
      </AdaptiveModal>
    </main>
  )
}
