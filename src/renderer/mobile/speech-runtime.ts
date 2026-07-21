import {
  connectId,
  DRM,
  dateToString,
  escapeXml,
  getHeadersAndData,
  mkssml,
  removeIncompatibleCharacters,
  SEC_MS_GEC_VERSION,
  ssmlHeadersPlusData,
  type TTSConfig,
  WSS_URL,
} from '@twn39/edgetts-js'
import { type NativeSpeechRecognitionStatus, yachiyoVoiceNative } from '@/platform/native/yachiyo_voice'
import { getSpeechCredentials } from './speech-credentials'
import { getSpeechSettings, parseSpeechHeaders, resolveSpeechEndpoint } from './speech-settings'

export interface SpeechPlaybackCallbacks {
  onStart?: () => void
  onEnd?: () => void
}

export interface SpeechRecognitionCallbacks {
  onPartial?: (text: string) => void
  onStateChange?: (state: 'starting' | 'listening' | 'speech' | 'processing' | 'finished') => void
}

let playbackGeneration = 0
let activeAudio: HTMLAudioElement | undefined
let activeAudioUrl: string | undefined
let activeAudioCancel: (() => void) | undefined
let activeRemoteRecognitionStop: (() => void) | undefined
let remoteRecognitionStopRequested = false
let nextRecognitionId = 1
let activeRecognition: { id: number; kind: 'android-local' | 'remote' } | undefined
let stopRequestedRecognitionId: number | undefined

function normalizeEdgeVoice(voice: string) {
  const match = voice.match(/^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/)
  if (!match) return voice
  const [, language, initialRegion, initialName] = match
  let region = initialRegion
  let name = initialName
  if (name.includes('-')) {
    region = `${region}-${name.slice(0, name.indexOf('-'))}`
    name = name.slice(name.indexOf('-') + 1)
  }
  return `Microsoft Server Speech Text to Speech Voice (${language}-${region}, ${name})`
}

async function synthesizeWithBing(text: string, voice: string): Promise<Uint8Array[]> {
  const token = await DRM.generateSecMsGec()
  const connectionId = connectId()
  const url = `${WSS_URL}&ConnectionId=${connectionId}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`
  const config: TTSConfig = {
    voice: normalizeEdgeVoice(voice),
    rate: '+0%',
    volume: '+0%',
    pitch: '+0Hz',
    boundary: 'SentenceBoundary',
  }

  return new Promise((resolve, reject) => {
    const audioChunks: Uint8Array[] = []
    const socket = new WebSocket(url)
    socket.binaryType = 'arraybuffer'
    let settled = false
    const timeout = window.setTimeout(() => finish(new Error('bing_tts_timeout')), 12_000)

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      socket.onopen = null
      socket.onmessage = null
      socket.onerror = null
      socket.onclose = null
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close()
      if (error) reject(error)
      else if (audioChunks.length === 0) reject(new Error('bing_tts_no_audio'))
      else resolve(audioChunks)
    }

    socket.onopen = () => {
      const speechConfig = [
        `X-Timestamp:${dateToString()}`,
        'Content-Type:application/json; charset=utf-8',
        'Path:speech.config',
        '',
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: 'true', wordBoundaryEnabled: 'false' },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        }),
        '',
      ].join('\r\n')
      socket.send(speechConfig)
      const escapedText = escapeXml(removeIncompatibleCharacters(text))
      socket.send(ssmlHeadersPlusData(connectId(), dateToString(), mkssml(config, escapedText)))
    }
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        if (event.data.includes('Path:turn.end')) finish()
        return
      }
      const data = new Uint8Array(event.data as ArrayBuffer)
      if (data.length < 2) return
      const headerLength = (data[0] << 8) | data[1]
      if (headerLength > data.length) return
      const frame = getHeadersAndData(data, headerLength)
      if (frame.headers.Path === 'audio' && frame.data.length > 0) audioChunks.push(frame.data)
    }
    socket.onerror = () => finish(new Error('bing_tts_connection_failed'))
    socket.onclose = (event) => {
      if (!settled && event.code !== 1000) finish(new Error(`bing_tts_closed_${event.code}`))
    }
  })
}

function authorizationHeaders(apiKey: string, additionalHeaders: string): Record<string, string> {
  const headers = parseSpeechHeaders(additionalHeaders)
  if (apiKey && !Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

async function captureRemoteSpeech(): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
    MediaRecorder.isTypeSupported(type)
  )
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: BlobPart[] = []
  return await new Promise<Blob>((resolve, reject) => {
    const timeout = window.setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), 8_000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      stream.getTracks().forEach((track) => track.stop())
      activeRemoteRecognitionStop = undefined
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => {
      cleanup()
      reject(new Error('speech_recording_failed'))
    }
    recorder.onstop = () => {
      cleanup()
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
    }
    activeRemoteRecognitionStop = () => recorder.state !== 'inactive' && recorder.stop()
    recorder.start(250)
    if (remoteRecognitionStopRequested) queueMicrotask(() => activeRemoteRecognitionStop?.())
  })
}

async function recognizeRemoteSpeech(callbacks: SpeechRecognitionCallbacks): Promise<string> {
  const settings = getSpeechSettings()
  remoteRecognitionStopRequested = false
  const credentials = await getSpeechCredentials()
  callbacks.onStateChange?.('starting')
  callbacks.onStateChange?.('listening')
  const audio = await captureRemoteSpeech()
  callbacks.onStateChange?.('processing')
  if (audio.size === 0) throw new Error('speech_recording_empty')
  const form = new FormData()
  form.append('file', new File([audio], 'speech.webm', { type: audio.type || 'audio/webm' }))
  form.append('model', settings.asrModel)
  form.append('language', settings.language.split('-')[0])
  const response = await fetch(resolveSpeechEndpoint(settings.asrBaseUrl, '/audio/transcriptions'), {
    method: 'POST',
    headers: authorizationHeaders(credentials.asrApiKey, settings.asrHeaders),
    body: form,
  })
  if (!response.ok) throw new Error(`speech_asr_http_${response.status}`)
  const result = (await response.json()) as { text?: string; output?: { text?: string } }
  const text = result.text ?? result.output?.text ?? ''
  if (!text.trim()) throw new Error('speech_asr_empty_result')
  return text.trim()
}

const SPEECH_ERROR_MESSAGES: Record<string, string> = {
  microphone_permission_denied: '请授予麦克风权限后再使用语音输入。',
  speech_service_unavailable: '系统未安装或未启用语音识别服务，请安装语音服务或在语音设置中配置 ASR API。',
  speech_network_timeout: '语音识别网络连接超时。',
  speech_network_error: '语音识别服务无法连接网络。',
  speech_audio_error: '无法读取麦克风音频。',
  speech_server_error: '语音识别服务暂时不可用。',
  speech_client_error: '语音识别被系统中断，请重试。',
  speech_timeout: '没有检测到语音，请重试。',
  speech_no_match: '没有识别出清晰的语音。',
  speech_recognizer_busy: '语音识别服务正忙，请稍后重试。',
  speech_permission_denied: '请授予麦克风权限后再使用语音输入。',
  speech_too_many_requests: '语音识别请求过于频繁，请稍后重试。',
  speech_server_disconnected: '语音识别服务连接已断开。',
  speech_language_not_supported: '当前语音识别服务不支持所选语言。',
  speech_language_unavailable: '所选语言的离线识别模型尚未下载。',
  speech_recording_failed: '录音失败，请检查麦克风权限。',
  speech_recording_empty: '没有录到声音，请重试。',
  speech_asr_empty_result: '没有识别出清晰的语音。',
  offline_asr_model_missing: '应用内置语音模型不完整，请重新安装应用。',
  offline_asr_runtime_unavailable: '当前设备无法加载内置语音识别运行库。',
  offline_asr_failed: '应用内置语音识别启动失败，请重试。',
}

export function getSpeechRecognitionErrorMessage(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate?.code === 'string' ? candidate.code : ''
  const message = typeof candidate?.message === 'string' ? candidate.message : ''
  if (SPEECH_ERROR_MESSAGES[code]) return SPEECH_ERROR_MESSAGES[code]
  if (SPEECH_ERROR_MESSAGES[message]) return SPEECH_ERROR_MESSAGES[message]
  if (message.startsWith('speech_asr_http_')) return `语音识别 API 请求失败（HTTP ${message.slice(16)}）。`
  if (message && !message.startsWith('speech_')) return message
  return '语音识别失败，请稍后重试。'
}

export function getAndroidSpeechRecognitionStatus(): Promise<NativeSpeechRecognitionStatus> {
  return yachiyoVoiceNative.getRecognitionStatus()
}

export async function recognizeAndroidSpeech(callbacks: SpeechRecognitionCallbacks = {}): Promise<string> {
  const settings = getSpeechSettings()
  const nativeAsr = settings.asrProvider === 'yachiyo-offline' || settings.asrProvider === 'android-system'
  const recognitionId = nextRecognitionId++
  activeRecognition = {
    id: recognitionId,
    kind: nativeAsr ? 'android-local' : 'remote',
  }
  if (nativeAsr) {
    let partialListener: Awaited<ReturnType<typeof yachiyoVoiceNative.addListener>> | undefined
    let stateListener: Awaited<ReturnType<typeof yachiyoVoiceNative.addListener>> | undefined
    try {
      const status = await getAndroidSpeechRecognitionStatus()
      const useOffline = settings.asrProvider === 'yachiyo-offline'
      if (useOffline && !status.offlineAvailable) throw new Error('offline_asr_model_missing')
      if (!useOffline && !status.systemRecognitionAvailable) throw new Error('speech_service_unavailable')
      partialListener = await yachiyoVoiceNative.addListener('speechPartialResult', ({ text }) => {
        if (text.trim()) callbacks.onPartial?.(text.trim())
      })
      stateListener = await yachiyoVoiceNative.addListener('speechRecognitionStateChanged', ({ state }) => {
        callbacks.onStateChange?.(state)
      })
      const resultPromise = yachiyoVoiceNative.startListening({
        language: settings.language,
        engine: useOffline ? 'offline' : 'system',
        preferOnDevice: status.onDeviceAvailable,
      })
      if (stopRequestedRecognitionId === recognitionId) await yachiyoVoiceNative.stopListening()
      return (await resultPromise).text.trim()
    } catch (error) {
      throw new Error(getSpeechRecognitionErrorMessage(error))
    } finally {
      await Promise.all([partialListener?.remove(), stateListener?.remove()])
      if (activeRecognition?.id === recognitionId) activeRecognition = undefined
      callbacks.onStateChange?.('finished')
    }
  }
  try {
    return await recognizeRemoteSpeech(callbacks)
  } catch (error) {
    throw new Error(getSpeechRecognitionErrorMessage(error))
  } finally {
    remoteRecognitionStopRequested = false
    if (activeRecognition?.id === recognitionId) activeRecognition = undefined
    callbacks.onStateChange?.('finished')
  }
}

export async function stopAndroidSpeechRecognition() {
  if (!activeRecognition) return
  stopRequestedRecognitionId = activeRecognition.id
  if (activeRecognition.kind === 'remote') {
    remoteRecognitionStopRequested = true
    activeRemoteRecognitionStop?.()
    return
  }
  await yachiyoVoiceNative.stopListening()
}
async function speakWithBing(text: string, voice: string, callbacks: SpeechPlaybackCallbacks, generation: number) {
  const chunks = await synthesizeWithBing(text, voice)
  if (generation !== playbackGeneration || chunks.length === 0) return

  const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' })
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  activeAudio = audio
  activeAudioUrl = url

  await new Promise<void>((resolve, reject) => {
    let started = false
    let finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      if (activeAudio === audio) activeAudio = undefined
      if (activeAudioUrl === url) activeAudioUrl = undefined
      if (activeAudioCancel === cancel) activeAudioCancel = undefined
      URL.revokeObjectURL(url)
      if (started) callbacks.onEnd?.()
      error ? reject(error) : resolve()
    }
    const cancel = () => finish()
    activeAudioCancel = cancel
    audio.onplaying = () => {
      if (!started) {
        started = true
        callbacks.onStart?.()
      }
    }
    audio.onended = () => finish()
    audio.onerror = () => finish(new Error('bing_tts_playback_failed'))
    void audio.play().catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
  })
}

async function speakWithAndroid(text: string, callbacks: SpeechPlaybackCallbacks) {
  let started = false
  const listener = await yachiyoVoiceNative.addListener('ttsStateChanged', ({ active }) => {
    if (active && !started) {
      started = true
      callbacks.onStart?.()
    } else if (!active && started) {
      started = false
      callbacks.onEnd?.()
    }
  })
  try {
    await yachiyoVoiceNative.speak({ text })
  } finally {
    await listener.remove()
    if (started) callbacks.onEnd?.()
  }
}

async function speakWithRemote(text: string, callbacks: SpeechPlaybackCallbacks, generation: number) {
  const settings = getSpeechSettings()
  const credentials = await getSpeechCredentials()
  const isGptSoVits = settings.ttsProvider === 'gpt-sovits'
  const endpoint = resolveSpeechEndpoint(settings.ttsBaseUrl, isGptSoVits ? '/tts' : '/audio/speech')
  const headers = {
    'Content-Type': 'application/json',
    ...authorizationHeaders(credentials.ttsApiKey, settings.ttsHeaders),
  }
  const body = isGptSoVits
    ? {
        text,
        text_lang: settings.language.split('-')[0],
        ref_audio_path: settings.voice,
        prompt_lang: settings.language.split('-')[0],
        prompt_text: '',
        text_split_method: 'cut5',
        media_type: 'wav',
        streaming_mode: false,
      }
    : { model: settings.ttsModel, input: text, voice: settings.voice, response_format: 'mp3' }
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`speech_tts_http_${response.status}`)
  const audioData = await response.arrayBuffer()
  if (generation !== playbackGeneration || audioData.byteLength === 0) return
  await playAudioBlob(new Blob([audioData], { type: response.headers.get('content-type') || 'audio/mpeg' }), callbacks)
}

async function playAudioBlob(blob: Blob, callbacks: SpeechPlaybackCallbacks) {
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  activeAudio = audio
  activeAudioUrl = url
  await new Promise<void>((resolve, reject) => {
    let started = false
    let finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      if (activeAudio === audio) activeAudio = undefined
      if (activeAudioUrl === url) activeAudioUrl = undefined
      if (activeAudioCancel === cancel) activeAudioCancel = undefined
      URL.revokeObjectURL(url)
      if (started) callbacks.onEnd?.()
      error ? reject(error) : resolve()
    }
    const cancel = () => finish()
    activeAudioCancel = cancel
    audio.onplaying = () => {
      if (!started) {
        started = true
        callbacks.onStart?.()
      }
    }
    audio.onended = () => finish()
    audio.onerror = () => finish(new Error('speech_playback_failed'))
    void audio.play().catch((error) => finish(error instanceof Error ? error : new Error(String(error))))
  })
}

export async function speakText(text: string, callbacks: SpeechPlaybackCallbacks = {}) {
  const normalized = text.trim()
  if (!normalized) return
  const generation = playbackGeneration
  const settings = getSpeechSettings()

  if (settings.ttsProvider === 'bing') {
    try {
      await speakWithBing(normalized, settings.voice, callbacks, generation)
      return
    } catch {
      if (generation !== playbackGeneration) return
    }
  }

  if (
    settings.ttsProvider !== 'bing' &&
    settings.ttsProvider !== 'android-system' &&
    generation === playbackGeneration
  ) {
    await speakWithRemote(normalized, callbacks, generation)
    return
  }

  if (generation === playbackGeneration) {
    await speakWithAndroid(normalized, callbacks)
  }
}

export async function stopSpeaking() {
  playbackGeneration += 1
  const audio = activeAudio
  const url = activeAudioUrl
  const cancel = activeAudioCancel
  activeAudio = undefined
  activeAudioUrl = undefined
  activeAudioCancel = undefined
  if (audio) {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
  if (cancel) cancel()
  else if (url) URL.revokeObjectURL(url)
  await yachiyoVoiceNative.stopSpeaking()
}
