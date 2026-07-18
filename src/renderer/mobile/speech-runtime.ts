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
import { yachiyoVoiceNative } from '@/platform/native/yachiyo_voice'
import { getSpeechCredentials } from './speech-credentials'
import { getSpeechSettings, parseSpeechHeaders, resolveSpeechEndpoint } from './speech-settings'

export interface SpeechPlaybackCallbacks {
  onStart?: () => void
  onEnd?: () => void
}

let playbackGeneration = 0
let activeAudio: HTMLAudioElement | undefined
let activeAudioUrl: string | undefined
let activeAudioCancel: (() => void) | undefined
let activeRemoteRecognitionStop: (() => void) | undefined

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
  })
}

async function recognizeRemoteSpeech(): Promise<string> {
  const settings = getSpeechSettings()
  const credentials = await getSpeechCredentials()
  const audio = await captureRemoteSpeech()
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

export async function recognizeAndroidSpeech(): Promise<string> {
  const settings = getSpeechSettings()
  if (settings.asrProvider === 'android-local') {
    return (await yachiyoVoiceNative.startListening({ language: settings.language })).text.trim()
  }
  return recognizeRemoteSpeech()
}

export async function stopAndroidSpeechRecognition() {
  if (activeRemoteRecognitionStop) {
    activeRemoteRecognitionStop()
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
