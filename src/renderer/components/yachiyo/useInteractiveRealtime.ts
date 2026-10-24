import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cancelPendingAgentApprovals, requestAgentApproval } from '@/mobile/agent-approval'
import { CORE_AGENT_PRINCIPAL } from '@shared/agent'
import { getCameraCaptureProvider, registerCameraCaptureProvider, type CameraCapture } from '@/mobile/camera-tool'
import { ensureRealtimeToolTask } from '@/mobile/realtime-tool-task'
import { RealtimeCall } from '@/mobile/realtime-runtime'
import { getRealtimeApiKey, getRealtimeSettings } from '@/mobile/realtime-settings'

export function useInteractiveRealtime(options: {
  sessionId?: string
  taskId?: string
  agentMode: boolean
  active: boolean
  cameraActive: boolean
  muted: boolean
  microphoneMuted: boolean
  vadThreshold: number
  onTaskId(id: string): void
  onError(message: string): void
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [text, setText] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [inputLevel, setInputLevel] = useState(0)
  const callRef = useRef<RealtimeCall>()
  const cleanupRef = useRef<() => Promise<void>>()
  const current = useRef(options)
  const videoApproved = useRef(false)
  const identityRef = useRef({ sessionId: options.sessionId, agentMode: options.agentMode })
  current.current = options
  const stop = useCallback(async () => {
    const call = callRef.current
    callRef.current = undefined
    const cleanup = cleanupRef.current
    cleanupRef.current = undefined
    await call?.close()
    await cleanup?.()
    if (!callRef.current) {
      setSpeaking(false)
      setInputLevel(0)
      setState('disconnected')
    }
  }, [])
  const start = async () => {
    if (callRef.current || !options.sessionId || !current.current.active) return
    const sessionId = options.sessionId
    const settings = getRealtimeSettings()
    setText('')
    const call = new RealtimeCall(settings, {
      onState: (next) => {
        if (callRef.current !== call) return
        setState(next)
        if (next === 'disconnected') void stop()
      },
      onSpeaking: (value) => {
        if (callRef.current === call) setSpeaking(value)
      },
      onInputLevel: (value) => {
        if (callRef.current === call) setInputLevel(value)
      },
      onText: (value) => {
        if (callRef.current === call) setText(value)
      },
      onTranscript: async (id, role, transcript, timestamp) => {
        const { saveRealtimeTranscript } = await import('@/mobile/realtime-context')
        await saveRealtimeTranscript(sessionId, targetTaskId, id, role, transcript, timestamp)
      },
      onTool: async (id, name, args, result, failed) => {
        const { saveRealtimeTool } = await import('@/mobile/realtime-context')
        await saveRealtimeTool(sessionId, targetTaskId, id, name, args, result, failed)
      },
      onError: (error) => current.current.onError(error),
    })
    let targetTaskId: string | undefined
    callRef.current = call
    setState('connecting')
    try {
      const key = await getRealtimeApiKey()
      if (call.abort.signal.aborted) return
      if (!key) throw new Error(String(t('请先在设置中配置 Realtime API 和密钥')))
      targetTaskId = await ensureRealtimeToolTask(sessionId)
      if (call.abort.signal.aborted) return
      current.current.onTaskId(targetTaskId)
      const provider = getCameraCaptureProvider(sessionId)
      if (provider && targetTaskId) registerCameraCaptureProvider(targetTaskId, provider)
      // Tool preparation is lazy: ordinary interactive conversations should not boot Agent services.
      const { prepareRealtimeContext } = await import('@/mobile/realtime-context')
      const context = await prepareRealtimeContext(
        sessionId,
        targetTaskId,
        call.abort.signal,
        () => {
          void call.close()
        },
        call.id
      )
      if (callRef.current !== call || call.abort.signal.aborted) {
        await context.dispose()
        return
      }
      cleanupRef.current = async () => {
        if (targetTaskId) cancelPendingAgentApprovals(targetTaskId)
        await context.dispose()
      }
      videoApproved.current = false
      if (callRef.current === call && !call.abort.signal.aborted)
        await call.connect(
          key,
          context.instructions,
          context.definitions,
          context.tools,
          context.history,
          current.current.muted,
          current.current.microphoneMuted
        )
      if (callRef.current === call) {
        await call.setMuted(current.current.muted)
        await call.setMicrophoneMuted(current.current.microphoneMuted)
        await call.setVadThreshold(current.current.vadThreshold)
      }
    } catch (error) {
      if (callRef.current === call) {
        current.current.onError(error instanceof Error ? error.message : String(t('实时通话连接失败')))
        await stop()
      }
    }
  }
  useEffect(() => {
    if (
      !options.active ||
      identityRef.current.sessionId !== options.sessionId ||
      identityRef.current.agentMode !== options.agentMode
    )
      void stop()
    identityRef.current = { sessionId: options.sessionId, agentMode: options.agentMode }
  }, [options.active, options.sessionId, options.agentMode, stop])
  useEffect(() => {
    void callRef.current?.setMuted(options.muted).catch(() => undefined)
  }, [options.muted])
  useEffect(() => {
    if (options.microphoneMuted) setInputLevel(0)
    void callRef.current?.setMicrophoneMuted(options.microphoneMuted).catch(() => undefined)
  }, [options.microphoneMuted])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void callRef.current
        ?.setVadThreshold(options.vadThreshold)
        .catch(() => current.current.onError(String(t('拾音阈值更新失败'))))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [options.vadThreshold, t])
  useEffect(() => {
    if (!options.cameraActive || state !== 'connected') {
      if (!options.cameraActive) {
        videoApproved.current = false
        callRef.current?.setVideoEnabled(false)
      }
      return
    }
    let disposed = false
    const call = callRef.current
    const consent = videoApproved.current
      ? Promise.resolve(true)
      : getRealtimeSettings().video && call
        ? requestAgentApproval({
            principal: CORE_AGENT_PRINCIPAL,
            sessionId: current.current.taskId || current.current.sessionId || '',
            title: '实时发送摄像头画面',
            detail: '本次通话中，每秒最多向配置的 Realtime API 发送一帧画面。关闭摄像头或结束通话即停止。',
            risk: 'dangerous',
            alwaysAsk: true,
            signal: call.abort.signal,
          })
        : Promise.resolve(false)
    void consent
      .then((approved) => {
        if (disposed || callRef.current !== call) return
        videoApproved.current = approved
        call?.setVideoEnabled(approved)
      })
      .catch(() => undefined)
    let busy = false
    const timer = window.setInterval(() => {
      const call = callRef.current
      const capture = getCameraCaptureProvider(current.current.taskId || current.current.sessionId)
      if (!call || !capture || busy || !current.current.cameraActive || !videoApproved.current) return
      busy = true
      void capture()
        .then((frame: CameraCapture) => call.sendImage(frame.data))
        .catch(() => undefined)
        .finally(() => {
          busy = false
        })
    }, 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [options.cameraActive, state])
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') void stop()
    }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      void stop()
    }
  }, [stop])
  return {
    state,
    text,
    speaking,
    inputLevel,
    start,
    stop,
    sendText: (value: string) => callRef.current?.sendText(value),
  }
}
