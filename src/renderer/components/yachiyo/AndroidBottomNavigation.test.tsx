/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IconPuzzle } from '@tabler/icons-react'
import i18n from '@/i18n'
import { AndroidBottomNavigation } from './AndroidBottomNavigation'

describe('AndroidBottomNavigation', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-Hans')
  })

  it('renders four stable destinations and reports selection', () => {
    const onChange = vi.fn()
    render(<AndroidBottomNavigation activeTab="chat" onChange={onChange} />)

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '聊天' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('button', { name: 'Agent' })).toBeNull()
    expect(screen.getByRole('button', { name: '交互式' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '任务' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('settings')
  })

  it('renders a host-provided plugin destination in the fifth slot', () => {
    const onChange = vi.fn()
    const items = [
      { id: 'chat', label: '聊天', icon: IconPuzzle, order: 100, route: '/' },
      { id: 'plugin-demo', label: 'Demo', icon: IconPuzzle, order: 200, route: '/plugin/demo' },
    ]
    render(<AndroidBottomNavigation activeTab="plugin-demo" items={items} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Demo' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    expect(onChange).toHaveBeenCalledWith('plugin-demo')
  })

  it('updates core navigation labels immediately when the language changes', async () => {
    render(<AndroidBottomNavigation activeTab="chat" onChange={vi.fn()} />)
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy()

    await act(async () => {
      await i18n.changeLanguage('en')
    })

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Chat' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Interactive' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tasks' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
  })
})
