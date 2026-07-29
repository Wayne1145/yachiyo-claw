/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { motionValue } from 'framer-motion'
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

  it('drives icon stroke and label weight from the shared transition progress', async () => {
    const progress = motionValue(0.25)
    const items = [
      { id: 'chat', label: '聊天', icon: IconPuzzle, order: 100, route: '/' },
      { id: 'settings', label: '设置', icon: IconPuzzle, order: 200, route: '/settings' },
    ]
    render(
      <AndroidBottomNavigation
        activeTab="chat"
        items={items}
        onChange={vi.fn()}
        transition={{ sourceIndex: 0, targetIndex: 1, progress }}
      />
    )

    const target = screen.getByRole('button', { name: '设置' })
    const content = target.querySelector('.yachiyo-bottom-nav-item-content') as HTMLElement
    const icon = target.querySelector('svg') as SVGElement
    const initialWeight = Number(content.style.fontWeight)
    const initialStroke = Number(icon.style.strokeWidth)

    act(() => progress.set(0.8))

    await waitFor(() => expect(Number(content.style.fontWeight)).toBeGreaterThan(initialWeight))
    await waitFor(() => expect(Number(icon.style.strokeWidth)).toBeGreaterThan(initialStroke))
  })

  it('keeps the reduced-motion lens stationary and unstretched until commit', () => {
    const presentationIndex = motionValue(0)
    const items = [
      { id: 'chat', label: '聊天', icon: IconPuzzle, order: 100, route: '/' },
      { id: 'settings', label: '设置', icon: IconPuzzle, order: 200, route: '/settings' },
    ]
    const { container } = render(
      <AndroidBottomNavigation
        activeTab="chat"
        items={items}
        onChange={vi.fn()}
        presentationIndex={presentationIndex}
        reducedMotion
      />
    )
    const lens = container.querySelector('.yachiyo-bottom-nav-lens') as HTMLElement
    const inner = container.querySelector('.yachiyo-bottom-nav-lens-inner') as HTMLElement

    expect(lens.style.transform).toBe('translate3d(0%, 0, 0)')
    expect(inner.style.transform).toBe('scaleX(1)')
    act(() => presentationIndex.set(1))
    expect(lens.style.transform).toBe('translate3d(0%, 0, 0)')
    expect(inner.style.transform).toBe('scaleX(1)')
  })
})
