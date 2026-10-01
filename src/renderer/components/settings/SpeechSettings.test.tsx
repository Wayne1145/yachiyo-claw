/** @vitest-environment jsdom */
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeechCredentials } from '@/mobile/speech-credentials'
import { DEFAULT_SPEECH_SETTINGS } from '@/mobile/speech-settings'
import { SpeechSettingsPage } from '@/routes/settings/speech'

const mocks = vi.hoisted(() => ({ read: vi.fn(), saveCredentials: vi.fn(), saveSettings: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/mobile/speech-credentials', () => ({
  getSpeechCredentials: mocks.read,
  saveSpeechCredentials: mocks.saveCredentials,
}))
vi.mock('@/mobile/speech-settings', async (original) => {
  const actual = await original<typeof import('@/mobile/speech-settings')>()
  return {
    ...actual,
    getSpeechSettings: () => ({ ...actual.DEFAULT_SPEECH_SETTINGS, asrProvider: 'openai-compatible' }),
    saveSpeechSettings: mocks.saveSettings,
  }
})
const credentials: SpeechCredentials = { asrApiKey: 'saved-test-value', ttsApiKey: '', asrHeaders: '', ttsHeaders: '' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.saveCredentials.mockResolvedValue(undefined)
  vi.stubGlobal(
    'matchMedia',
    vi
      .fn()
      .mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const mount = () =>
  render(
    <MantineProvider>
      <SpeechSettingsPage />
    </MantineProvider>
  )

describe('speech settings persistence', () => {
  it('waits for stored credentials before enabling editing and saving', async () => {
    let resolve: (value: SpeechCredentials) => void = () => {}
    mocks.read.mockReturnValue(
      new Promise<SpeechCredentials>((done) => {
        resolve = done
      })
    )
    mount()
    const save = screen.getByRole('button', { name: '保存语音设置' }) as HTMLButtonElement
    const key = screen.getByLabelText('ASR API Key') as HTMLInputElement
    expect(save.disabled).toBe(true)
    expect(key.disabled).toBe(true)
    fireEvent.click(save)
    expect(mocks.saveCredentials).not.toHaveBeenCalled()
    await act(async () => resolve(credentials))
    expect(key.value).toBe(credentials.asrApiKey)
    expect(key.disabled).toBe(false)
    fireEvent.change(key, { target: { value: 'edited-test-value' } })
    fireEvent.click(save)
    await waitFor(() =>
      expect(mocks.saveCredentials).toHaveBeenCalledWith({ ...credentials, asrApiKey: 'edited-test-value' })
    )
    expect(mocks.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SPEECH_SETTINGS, asrProvider: 'openai-compatible' })
    expect(screen.getByRole('status').textContent).toBe('语音设置已保存')
    fireEvent.change(key, { target: { value: 'another-test-value' } })
    expect(screen.queryByText('语音设置已保存')).toBeNull()
  })

  it('keeps saving disabled after a failed load and allows retry', async () => {
    mocks.read.mockRejectedValueOnce(new Error('test-read-failed')).mockResolvedValueOnce(credentials)
    mount()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect((screen.getByRole('button', { name: '保存语音设置' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '保存语音设置' }) as HTMLButtonElement).disabled).toBe(false)
    )
    expect((screen.getByLabelText('ASR API Key') as HTMLInputElement).value).toBe(credentials.asrApiKey)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
