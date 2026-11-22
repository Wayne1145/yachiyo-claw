/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectPreviewCard } from './ProjectPreviewCard'

const bridge = vi.hoisted(() => ({ registerWorkspacePreview: vi.fn(), openWorkspacePreview: vi.fn() }))
vi.mock('@/platform', () => ({ default: bridge }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('opening a delivered project', () => {
  afterEach(cleanup)
  beforeEach(() => vi.resetAllMocks())

  it('opens the saved project only when the reader taps the card', async () => {
    bridge.openWorkspacePreview.mockResolvedValue({ success: true })
    render(<ProjectPreviewCard preview={{ url: 'http://127.0.0.1:8080/game', previewId: 'saved', title: 'Tetris' }} />)
    expect(bridge.openWorkspacePreview).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Tetris/ }))
    await waitFor(() => expect(bridge.openWorkspacePreview).toHaveBeenCalledWith('saved'))
    expect(bridge.registerWorkspacePreview).not.toHaveBeenCalled()
  })

  it('restores an imported delivery on tap and keeps full query parameters out of the card label', async () => {
    bridge.openWorkspacePreview.mockRejectedValueOnce(new Error('preview_not_found')).mockResolvedValue({ success: true })
    bridge.registerWorkspacePreview.mockResolvedValue({ success: true, id: 'fresh' })
    render(<ProjectPreviewCard preview={{ url: 'http://localhost:8080/game?scene=1#start', previewId: 'old' }} />)
    const card = screen.getByRole('button')
    expect(card.textContent).not.toContain('scene=1')
    fireEvent.click(card)
    await waitFor(() => expect(bridge.openWorkspacePreview).toHaveBeenCalledWith('fresh'))
    expect(bridge.registerWorkspacePreview).toHaveBeenCalledWith({ port: 8080, path: '/game?scene=1#start' })
  })

  it('keeps the retry action available when the device cannot register a preview', async () => {
    bridge.registerWorkspacePreview.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true, id: 'retry' })
    bridge.openWorkspacePreview.mockResolvedValue({ success: true })
    render(<ProjectPreviewCard preview={{ url: 'http://127.0.0.1:8080' }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByRole('status')).toBeDefined()
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(bridge.openWorkspacePreview).toHaveBeenCalledWith('retry'))
  })
})
