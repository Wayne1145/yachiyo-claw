import { beforeEach, describe, expect, it, vi } from 'vitest'

const listeners = vi.hoisted(() => new Map<string, (event: never) => void>())
const native = vi.hoisted(() => ({
  getRecognitionStatus: vi.fn(),
  startListening: vi.fn(),
  stopListening: vi.fn(),
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  addListener: vi.fn((eventName: string, listener: (event: never) => void) => {
    listeners.set(eventName, listener)
    return Promise.resolve({
      remove: vi.fn(() => {
        listeners.delete(eventName)
        return Promise.resolve()
      }),
    })
  }),
}))

vi.mock('@capacitor/core', () => ({ registerPlugin: vi.fn(() => native) }))
vi.mock('./speech-settings', () => ({
  getSpeechSettings: vi.fn(() => ({
    asrProvider: 'android-local',
    language: 'zh-CN',
  })),
  parseSpeechHeaders: vi.fn(() => ({})),
  resolveSpeechEndpoint: vi.fn(),
}))
vi.mock('./speech-credentials', () => ({ getSpeechCredentials: vi.fn() }))

import {
  getSpeechRecognitionErrorMessage,
  recognizeAndroidSpeech,
  stopAndroidSpeechRecognition,
} from './speech-runtime'

describe('Android speech runtime', () => {
  beforeEach(() => {
    listeners.clear()
    vi.clearAllMocks()
    native.stopListening.mockResolvedValue(undefined)
  })

  it('reports a missing Android recognition service before recording', async () => {
    native.getRecognitionStatus.mockResolvedValue({
      recognitionAvailable: false,
      onDeviceAvailable: false,
      serviceCount: 0,
      listening: false,
    })

    await expect(recognizeAndroidSpeech()).rejects.toThrow('系统未安装或未启用语音识别服务')
    expect(native.startListening).not.toHaveBeenCalled()
  })

  it('forwards partial hypotheses and prefers an available on-device recognizer', async () => {
    native.getRecognitionStatus.mockResolvedValue({
      recognitionAvailable: true,
      onDeviceAvailable: true,
      serviceCount: 1,
      listening: false,
    })
    native.startListening.mockImplementation(() => {
      listeners.get('speechPartialResult')?.({ text: '八千' } as never)
      listeners.get('speechPartialResult')?.({ text: '八千代' } as never)
      return Promise.resolve({ text: '八千代你好' })
    })
    const partials: string[] = []

    await expect(recognizeAndroidSpeech({ onPartial: (text) => partials.push(text) })).resolves.toBe('八千代你好')
    expect(partials).toEqual(['八千', '八千代'])
    expect(native.startListening).toHaveBeenCalledWith({ language: 'zh-CN', preferOnDevice: true })
    expect(listeners.size).toBe(0)
  })

  it('remembers an early stop while the Android service status is still loading', async () => {
    let resolveStatus!: (status: unknown) => void
    native.getRecognitionStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve
      })
    )
    native.startListening.mockResolvedValue({ text: '' })

    const recognition = recognizeAndroidSpeech()
    await stopAndroidSpeechRecognition()
    resolveStatus({ recognitionAvailable: true, onDeviceAvailable: false, serviceCount: 1, listening: false })

    await expect(recognition).resolves.toBe('')
    expect(native.stopListening).toHaveBeenCalledTimes(2)
  })

  it('maps Android error codes to actionable text', () => {
    expect(
      getSpeechRecognitionErrorMessage({ code: 'speech_client_error', message: 'speech_recognition_error_5' })
    ).toBe('语音识别被系统中断，请重试。')
    expect(getSpeechRecognitionErrorMessage(new Error('speech_asr_http_401'))).toBe(
      '语音识别 API 请求失败（HTTP 401）。'
    )
  })
})
