/**
 * @vitest-environment jsdom
 */
import { MantineProvider } from '@mantine/core'
import { ApiError, NetworkError } from '@shared/models/errors'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { yachiyoInteractiveEnglish } from '@/i18n/yachiyo-resources-interactive'
import { YachiyoApiOnboarding } from './YachiyoApiOnboarding'

beforeAll(() => {
  const simplifiedChinese = Object.fromEntries(Object.keys(yachiyoInteractiveEnglish).map((key) => [key, key]))
  i18n.addResourceBundle('en', 'translation', yachiyoInteractiveEnglish, true, true)
  i18n.addResourceBundle('zh-Hans', 'translation', simplifiedChinese, true, true)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

beforeEach(async () => {
  await i18n.changeLanguage('zh-Hans')
})

function renderOnboarding(onSubmit = vi.fn(), onOpenProviders = vi.fn()) {
  render(
    <MantineProvider>
      <YachiyoApiOnboarding onSubmit={onSubmit} onOpenProviders={onOpenProviders} />
    </MantineProvider>
  )
  return { onSubmit, onOpenProviders }
}

describe('YachiyoApiOnboarding', () => {
  it('shows Yachiyo defaults without legacy Chatbox branding', () => {
    renderOnboarding()

    expect(screen.getByRole('heading', { name: '连接 Yachiyo API' })).toBeTruthy()
    expect(screen.getByText('api.yachiyo8000.cn/v1')).toBeTruthy()
    expect(screen.getByText('gpt-5.6')).toBeTruthy()
    expect(screen.queryByText(/Chatbox/i)).toBeNull()
    expect(screen.getByLabelText('API Key').getAttribute('type')).toBe('password')
  })

  it('validates and submits the key without placing it in visible text', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderOnboarding(onSubmit)

    fireEvent.click(screen.getByRole('button', { name: '保存并开始' }))
    expect(screen.getByText('请输入 API Key')).toBeTruthy()

    const input = screen.getByLabelText('API Key')
    fireEvent.change(input, { target: { value: 'sk-private-test' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并开始' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('sk-private-test'))
    expect(screen.queryByText('sk-private-test')).toBeNull()
    expect((input as HTMLInputElement).value).toBe('')
  })

  it.each([
    [new ApiError('Unauthorized', undefined, 401), 'API Key 无效或无权访问，请检查后重试'],
    [new NetworkError('offline', 'https://api.yachiyo8000.cn'), '无法连接 Yachiyo API，请检查网络后重试'],
    [new Error('settings_persist_failed'), '密钥验证成功，但安全保存失败，请重试'],
    [new Error('yachiyo_default_model_unavailable'), '服务可达，但默认模型 gpt-5.6 当前不可用'],
  ])('keeps the key editable after a recoverable validation failure', async (failure, message) => {
    const onSubmit = vi.fn().mockRejectedValue(failure)
    renderOnboarding(onSubmit)
    const input = screen.getByLabelText('API Key')

    fireEvent.change(input, { target: { value: 'sk-retry-me' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并开始' }))

    expect(await screen.findByText(message)).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('sk-retry-me')
  })

  it('opens the existing provider settings for other APIs', () => {
    const onOpenProviders = vi.fn()
    renderOnboarding(vi.fn(), onOpenProviders)

    fireEvent.click(screen.getByRole('button', { name: '使用其他 API 服务' }))
    expect(onOpenProviders).toHaveBeenCalledOnce()
  })

  it('updates the complete onboarding surface when English is selected', async () => {
    renderOnboarding()

    await act(async () => {
      await i18n.changeLanguage('en')
    })

    expect(screen.getByRole('heading', { name: 'Connect to Yachiyo API' })).toBeTruthy()
    expect(screen.getByLabelText('Default connection details')).toBeTruthy()
    expect(screen.getByText('Service')).toBeTruthy()
    expect(screen.getByText('Model')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save and continue' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use another API service' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    expect(screen.getByText('Enter an API Key')).toBeTruthy()
  })
})
