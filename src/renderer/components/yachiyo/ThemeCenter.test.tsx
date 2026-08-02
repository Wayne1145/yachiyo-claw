/** @vitest-environment jsdom */

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { applyActiveTheme, useThemeStore } from '@/stores/themeStore'
import { ThemeCenter } from './ThemeCenter'

vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }))

const validTheme = JSON.stringify({
  schemaVersion: 1,
  id: 'sakura-test',
  name: '樱色测试',
  version: '1.0.0',
  mode: 'light',
  tokens: { 'tint-brand': '#bd5f81' },
})

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

beforeEach(async () => {
  await i18n.changeLanguage('zh-Hans')
  localStorage.clear()
  useThemeStore.setState({ installed: [], activeThemeId: null, previewingTheme: null })
  applyActiveTheme()
})

function renderCenter() {
  return render(
    <MantineProvider>
      <ThemeCenter />
    </MantineProvider>
  )
}

describe('ThemeCenter', () => {
  it('offers the built-in liquid-glass theme without adding it to removable installs', () => {
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: '使用' }))

    expect(screen.getByText('Yachiyo 流光玻璃')).toBeTruthy()
    expect(document.documentElement.dataset.yachiyoAppearance).toBe('flow-glass')
    expect(useThemeStore.getState().installed).toHaveLength(0)
  })

  it('previews safely without persisting, then installs and activates explicitly', () => {
    renderCenter()
    fireEvent.change(screen.getByLabelText('主题 JSON'), { target: { value: validTheme } })
    fireEvent.click(screen.getByRole('button', { name: '预览' }))

    expect(screen.getByRole('status').textContent).toContain('樱色测试')
    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--chatbox-tint-brand')).toBe('#bd5f81')

    fireEvent.click(screen.getByRole('button', { name: '安装并使用' }))
    expect(useThemeStore.getState().activeThemeId).toBe('sakura-test')
    expect(localStorage.getItem('yachiyo:themes:active:v1')).toBe('sakura-test')
    expect(screen.getByText('樱色测试')).toBeTruthy()
  })

  it('rejects executable CSS values before previewing', () => {
    renderCenter()
    fireEvent.change(screen.getByLabelText('主题 JSON'), {
      target: { value: validTheme.replace('#bd5f81', 'url(https://example.invalid/x)') },
    })
    fireEvent.click(screen.getByRole('button', { name: '预览' }))

    expect(screen.getByRole('alert').textContent).toBe('主题包含无效或不安全的颜色值')
    expect(useThemeStore.getState().previewingTheme).toBeNull()
  })

  it('uses an in-app confirmation dialog with Chinese actions when deleting a theme', async () => {
    renderCenter()
    fireEvent.change(screen.getByLabelText('主题 JSON'), { target: { value: validTheme } })
    fireEvent.click(screen.getByRole('button', { name: '安装并使用' }))

    fireEvent.click(screen.getByRole('button', { name: '删除主题 樱色测试' }))
    expect(await screen.findByRole('dialog', { name: '删除主题' })).toBeTruthy()
    expect(screen.getByText('确定删除主题“樱色测试”？此操作无法撤销。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(useThemeStore.getState().installed).toHaveLength(0))
  })
})
