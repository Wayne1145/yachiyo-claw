/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AndroidBottomNavigation } from './AndroidBottomNavigation'

describe('AndroidBottomNavigation', () => {
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
})
