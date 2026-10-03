/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSettingsConfirmation } from './useSettingsConfirmation'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@mantine/core', () => ({
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Button: ({
    children,
    color: _color,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { color?: string; variant?: string }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}))
vi.mock('@/components/common/AdaptiveModal', () => ({
  AdaptiveModal: Object.assign(
    ({ opened, onClose, children }: { opened: boolean; onClose: () => void; children: ReactNode }) =>
      opened ? (
        <div role="dialog">
          <button type="button" onClick={onClose}>
            Dismiss
          </button>
          {children}
        </div>
      ) : null,
    { Actions: ({ children }: { children: ReactNode }) => <div>{children}</div> }
  ),
}))
afterEach(cleanup)

function Harness({ action }: { action: () => void }) {
  const { confirm, confirmation } = useSettingsConfirmation()
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          if (await confirm('Remove this item?')) action()
        }}
      >
        Remove
      </button>
      {confirmation}
    </>
  )
}

describe('settings confirmations', () => {
  it('requires explicit confirmation before performing the requested action', async () => {
    const action = vi.fn()
    render(<Harness action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(action).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm' })))
    expect(action).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it.each(['Cancel', 'Dismiss'])('cancels without performing the action on %s', async (name) => {
    const action = vi.fn()
    render(<Harness action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name })))
    expect(action).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('cancels an unresolved confirmation when its settings page unmounts', async () => {
    const action = vi.fn()
    const { unmount } = render(<Harness action={action} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await act(async () => unmount())
    expect(action).not.toHaveBeenCalled()
  })
})
