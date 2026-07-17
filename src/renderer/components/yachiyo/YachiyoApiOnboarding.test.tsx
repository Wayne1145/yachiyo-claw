/**
 * @vitest-environment jsdom
 */
import { MantineProvider } from '@mantine/core'
import { ApiError, NetworkError } from '@shared/models/errors'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { YachiyoApiOnboarding } from './YachiyoApiOnboarding'

beforeAll(() => {
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
})
